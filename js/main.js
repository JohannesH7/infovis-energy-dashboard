const GENERATION_URL = "data/entsoe_domestic_generation_2019_2025.json", FLOWS_URL = "data/entsoe_power_flows_2019_2025.json", GEO_URL = "data/europe.geojson";

let generationData = [], flowData = [], geoData = null, svg = null, path = null, flowSvg = null, lastNetworkData = null, networkAnchorProjection = null, networkAnchorPath = null, selectedMetric = "ShareIn%", selectedCountries = new Set, activeDashboardView = "generation", timePeriods = [], countryNameLookup = new Map, sidebarTipIndex = 0, sidebarTipTimer = null;

const mapWidth = 900, mapHeight = 610, flowMapWidth = 900, flowMapHeight = 560, monthNames = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December"
}, renewableSources = [ "Biomass", "Biomass / Biogas", "Geothermal", "Hydro Pumped Storage", "Hydro Run-of-river and poundage", "Hydro Run-Of-River And Poundage", "Hydro Water Reservoir", "Marine", "Other renewable", "Other Renewable", "Solar", "Waste", "Wind Offshore", "Wind Onshore" ], fossilSources = [ "Fossil Brown coal/Lignite", "Fossil Brown Coal/Lignite", "Fossil Brown Coal Lignite", "Fossil Coal-derived gas", "Fossil Coal Derived Gas", "Fossil Gas", "Fossil Hard coal", "Fossil Hard Coal", "Fossil Oil", "Fossil Oil shale", "Fossil Oil Shale", "Fossil Peat" ], countryCodeAliases = {
  UK: "GB",
  EL: "GR"
};


/* ---------- App bootstrap ---------- */
async function init() {
  try {
    const [generationResponse, flowsResponse, geoResponse] = await Promise.all([ fetch(GENERATION_URL), fetch(FLOWS_URL), fetch(GEO_URL) ]);
    if (!generationResponse.ok) throw new Error(`Could not load generation file: ${GENERATION_URL}`);
    if (!flowsResponse.ok) throw new Error(`Could not load flow file: ${FLOWS_URL}`);
    if (!geoResponse.ok) throw new Error(`Could not load geo file: ${GEO_URL}`);
    const rawGenerationData = await generationResponse.json(), rawFlowData = await flowsResponse.json();
    geoData = await geoResponse.json(), buildCountryNameLookup(), generationData = deduplicateEnergyRows(normalizeGenerationData(rawGenerationData)), 
    flowData = deduplicateFlowRows(normalizeFlowData(rawFlowData)), setupFilters(), 
    setupViewSwitch(), drawMap(), drawFlowNetworkMap(), updateDashboard();
  } catch (error) {
    showError(error.message);
  }
}


/* ---------- Data normalization and cleanup ---------- */
function normalizeGenerationData(rawData) {
  let rows = rawData;
  return Array.isArray(rawData) || (rows = rawData[Object.keys(rawData)[0]]), rows.map(row => {
    const month = toNumber(pickValue(row, [ "Month", "month" ])), year = toNumber(pickValue(row, [ "Year", "year" ]));
    return {
      Month: month,
      Year: year,
      dateIndex: 12 * year + month,
      Country: cleanCountryCode(pickValue(row, [ "Country", "country" ])),
      EnergySourceID: cleanText(pickValue(row, [ "EnergySourceID", "energy_source_id" ])),
      EnergySource: cleanText(pickValue(row, [ "EnergySource", "energy_source" ])),
      ValueInGWh: toNumber(pickValue(row, [ "ValueInGWh", "value_gwh", "Value in GWh" ])),
      "ShareIn%": toNumber(pickValue(row, [ "ShareIn%", "share_percent", "ShareInPercent" ]))
    };
  });
}

function normalizeFlowData(rawData) {
  let rows = rawData;
  return Array.isArray(rawData) || (rows = rawData[Object.keys(rawData)[0]]), rows.map(row => {
    const month = toNumber(pickValue(row, [ "Month", "month" ])), year = toNumber(pickValue(row, [ "Year", "year" ])), rawFromCountry = cleanCountryCode(pickValue(row, [ "FromCountry", "from_country", "From Country", "from country", "FromCountryMapCode", "From Country Map Code" ])), rawToCountry = cleanCountryCode(pickValue(row, [ "ToCountry", "to_country", "To Country", "to country", "ToCountryMapCode", "To Country Map Code" ])), flowDirection = cleanText(pickValue(row, [ "FlowDirection", "flow_direction", "Direction", "direction" ])), value = toNumber(pickValue(row, [ "ValueInGWh", "value_gwh", "Value in GWh", "Provided Value in GWh", "provided value in gwh" ])), physicalDirection = getPhysicalFlowDirection(rawFromCountry, rawToCountry, flowDirection);
    return {
      Month: month,
      Year: year,
      dateIndex: 12 * year + month,
      OriginalFromCountry: rawFromCountry,
      OriginalToCountry: rawToCountry,
      FromCountry: physicalDirection.from,
      ToCountry: physicalDirection.to,
      FlowDirection: flowDirection,
      ValueInGWh: value
    };
  }).filter(row => Number.isFinite(row.Year) && Number.isFinite(row.Month) && row.Month >= 1 && row.Month <= 12 && row.FromCountry && row.ToCountry);
}

function getPhysicalFlowDirection(fromCountry, toCountry, flowDirection) {
  const direction = cleanText(flowDirection).toLowerCase();
  return direction.includes("import") ? {
    from: toCountry,
    to: fromCountry
  } : (direction.includes("export"), {
    from: fromCountry,
    to: toCountry
  });
}

function deduplicateEnergyRows(rows) {
  const seen = new Map;
  let duplicateCount = 0;
  return rows.forEach(row => {
    if (!Number.isFinite(row.Year) || !Number.isFinite(row.Month) || row.Month < 1 || row.Month > 12 || !row.Country || !row.EnergySource) return;
    const key = [ row.Country, row.Year, row.Month, row.EnergySourceID || row.EnergySource ].join("|");
    if (seen.has(key)) {
      duplicateCount += 1;
      const existing = seen.get(key);
      (0 === existing.ValueInGWh || !Number.isFinite(existing.ValueInGWh)) && row.ValueInGWh > 0 && seen.set(key, row);
    } else seen.set(key, row);
  }), [ ...seen.values() ];
}

function deduplicateFlowRows(rows) {
  const seen = new Map;
  let duplicateCount = 0;
  return rows.forEach(row => {
    if (!Number.isFinite(row.Year) || !Number.isFinite(row.Month) || row.Month < 1 || row.Month > 12 || !row.FromCountry || !row.ToCountry || row.FromCountry === row.ToCountry) return;
    const key = [ row.Year, row.Month, row.FromCountry, row.ToCountry ].join("|");
    if (seen.has(key)) {
      duplicateCount += 1;
      const existing = seen.get(key);
      row.ValueInGWh > existing.ValueInGWh && seen.set(key, row);
    } else seen.set(key, row);
  }), [ ...seen.values() ];
}


/* ---------- View switching, filters and selections ---------- */
function setupViewSwitch() {
  const buttons = document.querySelectorAll(".view-tab[data-view]");
  if (!buttons.length) return;
  buttons.forEach(button => {
    button.addEventListener("click", () => {
      setActiveDashboardView(button.dataset.view, !0);
    });
  });
  const hashView = window.location.hash.replace("#", "");
  setActiveDashboardView("flows" === hashView || "generation" === hashView ? hashView : activeDashboardView, !1);
}

function setActiveDashboardView(view, updateHash = !0) {
  "generation" !== view && "flows" !== view && (view = "generation"), activeDashboardView = view, 
  document.querySelectorAll(".view-tab[data-view]").forEach(button => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("active", isActive), button.setAttribute("aria-selected", isActive ? "true" : "false"), 
    button.tabIndex = isActive ? 0 : -1;
  }), document.querySelectorAll(".view-panel[data-view-panel]").forEach(panel => {
    const isActive = panel.dataset.viewPanel === view;
    panel.classList.toggle("active", isActive), panel.hidden = !isActive;
  });
  const title = document.getElementById("activeViewTitle"), description = document.getElementById("activeViewDescription");
  if (title && (title.textContent = "generation" === view ? "Generation map" : "Power flow network"), 
  description && (description.textContent = "generation" === view ? "Inspect electricity generation by country, source and metric." : "Inspect cross-border electricity exchange as an interactive network."), 
  updateHash) {
    const newHash = "generation" === view ? "" : "#flows";
    window.location.hash !== newHash && history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
  }
  window.requestAnimationFrame(() => {
    updateDashboard();
  });
}

function setupFilters() {
  setupTimeRangeFilter(), setupCountryFilter(), setupEnergySourceFilter(), setupMetricToggle();
  const resetButton = document.getElementById("resetFilters");
  resetButton && (resetButton.addEventListener("click", resetFilters), setupCompactFilterHeader(resetButton));
}

function setupCompactFilterHeader(resetButton) {
  const filterPanel = document.querySelector(".sidebar .filter-panel") || document.querySelector(".sidebar .panel");
  if (!filterPanel || !resetButton) return;
  const title = filterPanel.querySelector("h2");
  if (!title) return;
  resetButton.classList.add("icon-reset"), resetButton.setAttribute("title", "Reset filters"), 
  resetButton.setAttribute("aria-label", "Reset filters"), resetButton.innerHTML = '\n    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">\n      <path\n        d="M4 6h10M4 12h7M4 18h10"\n        fill="none"\n        stroke="currentColor"\n        stroke-width="2"\n        stroke-linecap="round"\n      />\n      <path\n        d="M17 9l4 4M21 9l-4 4"\n        fill="none"\n        stroke="currentColor"\n        stroke-width="2"\n        stroke-linecap="round"\n      />\n    </svg>\n  ';
  let heading = filterPanel.querySelector(".filter-panel-heading");
  heading || (heading = document.createElement("div"), heading.className = "filter-panel-heading", 
  filterPanel.insertBefore(heading, title), heading.appendChild(title)), heading.appendChild(resetButton);
}

function setupTimeRangeFilter() {
  timePeriods = uniqueSorted(generationData.map(d => d.dateIndex)).map(index => {
    const year = Math.floor((index - 1) / 12), month = index - 12 * year;
    return {
      index: index,
      year: year,
      month: month,
      label: `${monthNames[month]} ${year}`
    };
  });
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange");
  if (!startSlider || !endSlider) return;
  startSlider.min = 0, startSlider.max = timePeriods.length - 1, startSlider.value = 0, 
  endSlider.min = 0, endSlider.max = timePeriods.length - 1, endSlider.value = timePeriods.length - 1, 
  startSlider.addEventListener("input", () => {
    Number(startSlider.value) > Number(endSlider.value) && (startSlider.value = endSlider.value), 
    updateTimeLabels(), updateDashboard();
  }), endSlider.addEventListener("input", () => {
    Number(endSlider.value) < Number(startSlider.value) && (endSlider.value = startSlider.value), 
    updateTimeLabels(), updateDashboard();
  });
  const wholeYearButton = document.getElementById("wholeYearBtn"), singleMonthButton = document.getElementById("singleMonthBtn"), fullRangeButton = document.getElementById("fullRangeBtn");
  wholeYearButton && wholeYearButton.addEventListener("click", selectWholeYear), singleMonthButton && singleMonthButton.addEventListener("click", selectSingleMonth), 
  fullRangeButton && fullRangeButton.addEventListener("click", selectFullRange), createTimelineTicks(), 
  updateTimeLabels();
}

function selectWholeYear() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange"), currentEndIndex = Number(endSlider.value), currentYear = timePeriods[currentEndIndex].year, periodsInYear = timePeriods.map((period, sliderIndex) => ({
    ...period,
    sliderIndex: sliderIndex
  })).filter(period => period.year === currentYear);
  0 !== periodsInYear.length && (startSlider.value = periodsInYear[0].sliderIndex, 
  endSlider.value = periodsInYear[periodsInYear.length - 1].sliderIndex, updateTimeLabels(), 
  updateDashboard());
}

function selectSingleMonth() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange");
  startSlider.value = endSlider.value, updateTimeLabels(), updateDashboard();
}

function selectFullRange() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange");
  startSlider.value = 0, endSlider.value = timePeriods.length - 1, updateTimeLabels(), 
  updateDashboard();
}

function updateTimeLabels() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange"), startDateLabel = document.getElementById("startDateLabel"), endDateLabel = document.getElementById("endDateLabel");
  if (!(startSlider && endSlider && startDateLabel && endDateLabel)) return;
  const startIndex = Number(startSlider.value), endIndex = Number(endSlider.value);
  startDateLabel.textContent = timePeriods[startIndex]?.label || "-", endDateLabel.textContent = timePeriods[endIndex]?.label || "-", 
  updateTimelineVisual();
}

function updateTimelineVisual() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange"), selection = document.getElementById("timelineSelection");
  if (!startSlider || !endSlider || !selection || timePeriods.length <= 1) return;
  const startValue = Number(startSlider.value), endValue = Number(endSlider.value), max = timePeriods.length - 1, leftPercent = startValue / max * 100, rightPercent = endValue / max * 100;
  selection.style.left = `${leftPercent}%`, selection.style.width = rightPercent - leftPercent + "%";
}

function createTimelineTicks() {
  const tickContainer = document.getElementById("timelineTicks");
  if (!tickContainer || timePeriods.length <= 1) return;
  tickContainer.innerHTML = "";
  const max = timePeriods.length - 1, yearTicks = [];
  timePeriods.forEach((period, index) => {
    const isFirstPeriod = 0 === index, isJanuary = 1 === period.month;
    (isFirstPeriod || isJanuary) && yearTicks.push({
      ...period,
      sliderIndex: index
    });
  });
  const labelStep = Math.ceil(yearTicks.length / 5);
  yearTicks.forEach((period, index) => {
    const tick = document.createElement("span");
    tick.className = "timeline-tick tick-major";
    const left = period.sliderIndex / max * 100;
    tick.style.left = `${left}%`;
    const shouldShowLabel = 0 === index || index === yearTicks.length - 1 || index % labelStep === 0;
    tick.textContent = shouldShowLabel ? period.year : "", tickContainer.appendChild(tick);
  });
}

function setupCountryFilter() {
  fillSelect("countryFilter", [ "all", ...uniqueSorted([ ...generationData.map(d => d.Country), ...flowData.flatMap(d => [ d.FromCountry, d.ToCountry ]) ]) ], value => "all" === value ? "All Countries" : getDisplayCountry(value));
  const countryFilter = document.getElementById("countryFilter");
  countryFilter && (countryFilter.value = "all", countryFilter.addEventListener("change", () => {
    selectedCountries.clear(), "all" !== countryFilter.value && selectedCountries.add(countryFilter.value), 
    updateDashboard();
  }));
}

function setupEnergySourceFilter() {
  const select = document.getElementById("energySourceFilter");
  if (!select) return;
  select.innerHTML = "", [ {
    value: "group:all",
    label: "All energy sources"
  }, {
    value: "group:renewable",
    label: "Renewables"
  }, {
    value: "group:fossil",
    label: "Fossil fuels"
  } ].forEach(item => {
    const option = document.createElement("option");
    option.value = item.value, option.textContent = item.label, select.appendChild(option);
  });
  const singleGroup = document.createElement("optgroup");
  singleGroup.label = "Single energy sources", uniqueSorted(generationData.map(d => d.EnergySource)).forEach(source => {
    const option = document.createElement("option");
    option.value = `source:${source}`, option.textContent = source, singleGroup.appendChild(option);
  }), select.appendChild(singleGroup), select.value = "group:renewable", select.addEventListener("change", updateDashboard);
}

function setupMetricToggle() {
  selectedMetric = "ShareIn%", updateMetricButtons(), document.querySelectorAll("#metricToggle button").forEach(button => {
    button.addEventListener("click", () => {
      selectedMetric = button.dataset.metric, updateMetricButtons(), updateDashboard();
    });
  });
}

function updateMetricButtons() {
  document.querySelectorAll("#metricToggle button").forEach(button => {
    button.classList.toggle("active", button.dataset.metric === selectedMetric);
  });
}

function resetFilters() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange"), countryFilter = document.getElementById("countryFilter"), energySourceFilter = document.getElementById("energySourceFilter");
  startSlider && endSlider && (startSlider.value = 0, endSlider.value = timePeriods.length - 1), 
  selectedCountries.clear(), countryFilter && (countryFilter.value = "all"), energySourceFilter && (energySourceFilter.value = "group:renewable"), 
  selectedMetric = "ShareIn%", updateMetricButtons(), updateTimeLabels(), updateDashboard();
}

function getFilters() {
  const startSlider = document.getElementById("startTimeRange"), endSlider = document.getElementById("endTimeRange"), startSliderIndex = startSlider ? Number(startSlider.value) : 0, endSliderIndex = endSlider ? Number(endSlider.value) : timePeriods.length - 1, startPeriod = timePeriods[startSliderIndex], endPeriod = timePeriods[endSliderIndex], countries = [ ...selectedCountries ];
  return {
    startIndex: startPeriod?.index,
    endIndex: endPeriod?.index,
    startLabel: startPeriod?.label || "-",
    endLabel: endPeriod?.label || "-",
    country: 0 === countries.length ? "all" : 1 === countries.length ? countries[0] : "multiple",
    countries: countries,
    energySelection: document.getElementById("energySourceFilter")?.value || "group:renewable",
    metric: selectedMetric
  };
}

function getCountrySet(filters) {
  return new Set(filters.countries || []);
}

function hasCountrySelection(filters) {
  return (filters.countries || []).length > 0;
}

function isCountrySelected(filters, countryCode) {
  return getCountrySet(filters).has(cleanCountryCode(countryCode));
}

function syncCountryFilterWithSelectedCountries() {
  const countryFilter = document.getElementById("countryFilter");
  if (countryFilter) if (1 === selectedCountries.size) {
    const country = [ ...selectedCountries ][0], hasOption = [ ...countryFilter.options ].some(option => option.value === country);
    countryFilter.value = hasOption ? country : "all";
  } else countryFilter.value = "all";
}

function updateCountrySelection(countryCode, additive) {
  const cleanCode = cleanCountryCode(countryCode);
  cleanCode && (additive ? selectedCountries.has(cleanCode) ? selectedCountries.delete(cleanCode) : selectedCountries.add(cleanCode) : 1 === selectedCountries.size && selectedCountries.has(cleanCode) ? selectedCountries.clear() : (selectedCountries.clear(), 
  selectedCountries.add(cleanCode)), syncCountryFilterWithSelectedCountries());
}

function getCountrySelectionLabel(filters) {
  const countries = filters.countries || [];
  return 0 === countries.length ? "All countries" : 1 === countries.length ? getDisplayCountry(countries[0]) : `${countries.length} selected countries`;
}


/* ---------- Energy-source grouping ---------- */
function matchesEnergySelection(row, selection) {
  if ("group:all" === selection) return !0;
  if ("group:renewable" === selection) return renewableSources.includes(row.EnergySource);
  if ("group:fossil" === selection) return fossilSources.includes(row.EnergySource);
  if (selection.startsWith("source:")) {
    const source = selection.replace("source:", "");
    return row.EnergySource === source;
  }
  return !1;
}

function getReadableEnergySelection(selection) {
  return "group:all" === selection ? "All energy sources" : "group:renewable" === selection ? "Renewables" : "group:fossil" === selection ? "Fossil fuels" : selection.startsWith("source:") ? selection.replace("source:", "") : selection;
}


/* ---------- Generation choropleth map ---------- */
function drawMap() {
  const container = document.getElementById("map");
  if (!container) return;
  container.innerHTML = "", svg = d3.select("#map").append("svg").attr("viewBox", "0 0 900 610").attr("preserveAspectRatio", "xMidYMid meet");
  const projection = d3.geoMercator();
  path = d3.geoPath().projection(projection), projection.fitSize([ 900, 610 ], geoData), 
  svg.append("rect").attr("class", "map-background-click").attr("x", 0).attr("y", 0).attr("width", 900).attr("height", 610).attr("fill", "transparent").style("pointer-events", "all").on("click", clearCountrySelectionFromMap), 
  svg.append("g").attr("class", "countries").selectAll("path").data(geoData.features).join("path").attr("class", "country").attr("d", path).attr("fill", "#d1d5db").on("mousemove", onCountryHover).on("mouseleave", hideTooltip).on("click", onCountryClick);
}

function updateMap(filters) {
  if (!svg) return;
  const aggregatedByCountry = aggregateGenerationByCountry(generationData, filters), selectedSet = getCountrySet(filters), values = [ ...aggregatedByCountry.values() ].map(row => row.selectedValue).filter(value => Number.isFinite(value) && value > 0), maxValue = d3.max(values) || 1, colorScale = d3.scaleLinear().domain([ 0, maxValue ]).range([ "#DCEBFF", "#1F3A5F" ]);
  svg.selectAll(".country").transition().duration(250).attr("fill", feature => {
    const code = getGeoCountryCode(feature), row = aggregatedByCountry.get(code);
    return !row || row.selectedValue <= 0 ? "#d1d5db" : selectedSet.size > 0 && !selectedSet.has(code) ? "#e5e7eb" : colorScale(row.selectedValue);
  }), svg.selectAll(".country").classed("selected", feature => {
    const code = getGeoCountryCode(feature);
    return selectedSet.has(code);
  }).each(function(feature) {
    const code = getGeoCountryCode(feature);
    this.__energyRow = aggregatedByCountry.get(code) || null, this.__filters = filters;
  });
  const unit = "ValueInGWh" === filters.metric ? "GWh" : "%", legendMax = document.getElementById("legendMax");
  legendMax && (legendMax.textContent = `Max: ${formatNumber(maxValue)} ${unit}`);
}

function aggregateGenerationByCountry(allRows, filters) {
  const countryMonthMap = new Map;
  allRows.forEach(row => {
    if (!(row.dateIndex >= filters.startIndex && row.dateIndex <= filters.endIndex)) return;
    const key = `${row.Country}-${row.Year}-${row.Month}`;
    countryMonthMap.has(key) || countryMonthMap.set(key, {
      country: row.Country,
      year: row.Year,
      month: row.Month,
      totalGwh: 0,
      selectedGwh: 0
    });
    const entry = countryMonthMap.get(key);
    entry.totalGwh += row.ValueInGWh, matchesEnergySelection(row, filters.energySelection) && (entry.selectedGwh += row.ValueInGWh);
  });
  const countryMap = new Map;
  return countryMonthMap.forEach(monthEntry => {
    if (monthEntry.totalGwh <= 0) return;
    countryMap.has(monthEntry.country) || countryMap.set(monthEntry.country, {
      country: monthEntry.country,
      valueGwh: 0,
      monthlyShares: [],
      selectedValue: 0
    });
    const countryEntry = countryMap.get(monthEntry.country), monthlyShare = monthEntry.selectedGwh / monthEntry.totalGwh * 100, safeMonthlyShare = Math.max(0, Math.min(100, monthlyShare));
    countryEntry.valueGwh += monthEntry.selectedGwh, countryEntry.monthlyShares.push(safeMonthlyShare);
  }), countryMap.forEach(countryEntry => {
    "ValueInGWh" === filters.metric ? countryEntry.selectedValue = countryEntry.valueGwh : countryEntry.selectedValue = average(countryEntry.monthlyShares);
  }), countryMap;
}

function onCountryHover(event, feature) {
  const code = getGeoCountryCode(feature), name = getGeoCountryName(feature), row = this.__energyRow, filters = this.__filters || getFilters(), tooltip = d3.select("#tooltip");
  if (!row) return void tooltip.style("opacity", 1).html(`\n        <strong>${name} (${code})</strong><br>\n        No data for selected filter.<br><br>\n        <em>Tip: Shift + click to add or remove countries.</em>\n      `).style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
  const metricValue = "ValueInGWh" === filters.metric ? `${formatNumber(row.selectedValue)} GWh` : `${formatNumber(row.selectedValue)}%`;
  tooltip.style("opacity", 1).html(`\n      <strong>${name} (${code})</strong><br>\n      Energy selection: ${getReadableEnergySelection(filters.energySelection)}<br>\n      Total value: ${formatNumber(row.valueGwh)} GWh<br>\n      Selected metric: ${metricValue}<br>\n      Time range: ${filters.startLabel} – ${filters.endLabel}<br><br>\n      <em>Click to select. Shift + click to select multiple countries.</em>\n    `).style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
}

function hideTooltip() {
  d3.select("#tooltip").style("opacity", 0);
}

function onCountryClick(event, feature) {
  event.stopPropagation();
  const code = getGeoCountryCode(feature), countryFilter = document.getElementById("countryFilter");
  countryFilter && [ ...countryFilter.options ].some(option => option.value === code) && (updateCountrySelection(code, event.shiftKey), 
  updateDashboard());
}


/* ---------- Power-flow KPIs and partner ranking ---------- */
function updatePowerFlowView(filters) {
  const flowSubtitle = document.getElementById("flowSubtitle"), totalImports = document.getElementById("totalImports"), totalExports = document.getElementById("totalExports"), netBalance = document.getElementById("netBalance");
  if (!totalImports || !totalExports || !netBalance) return;
  updateFlowNetworkMap(filters);
  const result = aggregateFlowsForSelection(filters);
  flowSubtitle && (hasCountrySelection(filters) ? flowSubtitle.textContent = `${getCountrySelectionLabel(filters)}, ${filters.startLabel} to ${filters.endLabel}.` : flowSubtitle.textContent = `${filters.startLabel} to ${filters.endLabel}. Showing total European cross-border exchange.`), 
  totalImports.textContent = `${formatNumber(result.totalImports)} GWh`, totalExports.textContent = `${formatNumber(result.totalExports)} GWh`, 
  netBalance.textContent = `${formatSignedNumber(result.totalExports - result.totalImports)} GWh`, 
  renderPartnerComparison(result.topImports, result.topExports, "No import data available.", "No export data available.");
}

function aggregateFlowsForSelection(filters) {
  return hasCountrySelection(filters) ? aggregateFlowsForCountryGroup(filters) : aggregateGlobalFlowSummary(filters);
}

function aggregateGlobalFlowSummary(filters) {
  const countryStats = new Map;
  let totalExchange = 0;
  flowData.forEach(row => {
    if (!(row.dateIndex >= filters.startIndex && row.dateIndex <= filters.endIndex)) return;
    const value = row.ValueInGWh;
    !Number.isFinite(value) || value <= 0 || row.FromCountry && row.ToCountry && row.FromCountry !== row.ToCountry && (totalExchange += value, 
    ensureCountryFlowStats(countryStats, row.FromCountry), ensureCountryFlowStats(countryStats, row.ToCountry), 
    countryStats.get(row.FromCountry).exports += value, countryStats.get(row.ToCountry).imports += value);
  });
  const stats = [ ...countryStats.values() ];
  return {
    totalImports: totalExchange,
    totalExports: totalExchange,
    topImports: stats.map(item => ({
      country: item.country,
      value: item.imports
    })).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 3),
    topExports: stats.map(item => ({
      country: item.country,
      value: item.exports
    })).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 3)
  };
}

function aggregateFlowsForCountryGroup(filters) {
  const selectedSet = getCountrySet(filters), importPartners = new Map, exportPartners = new Map;
  flowData.forEach(row => {
    if (!(row.dateIndex >= filters.startIndex && row.dateIndex <= filters.endIndex)) return;
    const value = row.ValueInGWh;
    if (!Number.isFinite(value) || value <= 0) return;
    const fromSelected = selectedSet.has(row.FromCountry), toSelected = selectedSet.has(row.ToCountry);
    fromSelected && toSelected || (toSelected && !fromSelected && addToMap(importPartners, row.FromCountry, value), 
    fromSelected && !toSelected && addToMap(exportPartners, row.ToCountry, value));
  });
  const imports = mapToSortedPartnerArray(importPartners), exports = mapToSortedPartnerArray(exportPartners);
  return {
    totalImports: imports.reduce((sum, item) => sum + item.value, 0),
    totalExports: exports.reduce((sum, item) => sum + item.value, 0),
    topImports: imports.slice(0, 3),
    topExports: exports.slice(0, 3)
  };
}

function ensureCountryFlowStats(map, country) {
  map.has(country) || map.set(country, {
    country: country,
    imports: 0,
    exports: 0
  });
}

function addToMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function mapToSortedPartnerArray(map) {
  return [ ...map.entries() ].map(([country, value]) => ({
    country: country,
    value: value
  })).sort((a, b) => b.value - a.value);
}

function renderFlowList(listId, items, emptyMessage) {
  const list = document.getElementById(listId);
  if (list) {
    if (list.innerHTML = "", !items.length) {
      const emptyItem = document.createElement("li");
      return emptyItem.className = "flow-empty", emptyItem.textContent = emptyMessage, 
      void list.appendChild(emptyItem);
    }
    items.forEach(item => {
      const li = document.createElement("li");
      li.innerHTML = `\n      <strong>${getDisplayCountry(item.country)}</strong><br>\n      <span class="partner-value">${formatNumber(item.value)} GWh</span>\n    `, 
      list.appendChild(li);
    });
  }
}

function renderPartnerComparison(importItems, exportItems, importEmptyMessage, exportEmptyMessage) {
  const container = document.getElementById("partnerComparison");
  if (!container) return;
  container.innerHTML = "";
  const maxValue = d3.max([ ...importItems.map(item => item.value), ...exportItems.map(item => item.value) ]) || 1, rowCount = Math.max(importItems.length, exportItems.length, 3);
  for (let index = 0; index < rowCount; index += 1) {
    const importItem = importItems[index] || null, exportItem = exportItems[index] || null, row = document.createElement("div");
    row.className = "partner-comparison-row", row.innerHTML = `\n      ${createPartnerComparisonSide(importItem, "import", maxValue, importEmptyMessage)}\n      <div class="partner-comparison-rank">${index + 1}</div>\n      ${createPartnerComparisonSide(exportItem, "export", maxValue, exportEmptyMessage)}\n    `, 
    container.appendChild(row);
  }
}

function createPartnerComparisonSide(item, direction, maxValue, emptyMessage) {
  if (!item) return `\n      <div class="partner-comparison-side ${direction} empty">\n        <span class="partner-comparison-name">${emptyMessage}</span>\n        <div class="partner-comparison-track">\n          <span class="partner-comparison-fill" style="width: 0%"></span>\n        </div>\n        <span class="partner-comparison-value">-</span>\n      </div>\n    `;
  const percentage = Math.max(7, item.value / maxValue * 100);
  return `\n    <div class="partner-comparison-side ${direction}">\n      <span class="partner-comparison-name">${getDisplayCountry(item.country)}</span>\n      <div class="partner-comparison-track">\n        <span class="partner-comparison-fill" style="width: ${percentage}%"></span>\n      </div>\n      <span class="partner-comparison-value">${formatNumber(item.value)} GWh</span>\n    </div>\n  `;
}


/* ---------- Power-flow network diagram ---------- */
function drawFlowNetworkMap() {
  const container = document.getElementById("flowNetworkMap");
  container && (container.innerHTML = "", flowSvg = d3.select("#flowNetworkMap").append("svg").attr("viewBox", "0 0 900 560").attr("preserveAspectRatio", "xMidYMid meet"), 
  flowSvg.append("rect").attr("class", "network-background-click").attr("x", 0).attr("y", 0).attr("width", 900).attr("height", 560).on("click", clearCountrySelectionFromNetwork), 
  flowSvg.append("g").attr("class", "network-links-layer"), flowSvg.append("g").attr("class", "network-nodes-layer"), 
  flowSvg.append("g").attr("class", "network-labels-layer"), flowSvg.append("g").attr("class", "network-legend"), 
  drawNetworkLegend());
}

function drawNetworkLegend() {
  const legend = flowSvg.select(".network-legend");
  legend.selectAll("*").remove();
  legend.append("text").attr("class", "network-legend-title").attr("x", 18).attr("y", 22).text("Network guide"), 
  legend.append("circle").attr("cx", 25).attr("cy", 46).attr("r", 5.5).attr("fill", "#ffffff").attr("stroke", "#3B82F6").attr("stroke-width", 2.4), 
  legend.append("text").attr("x", 40).attr("y", 50).text("Net importer"), legend.append("circle").attr("cx", 25).attr("cy", 66).attr("r", 5.5).attr("fill", "#ffffff").attr("stroke", "#D96C50").attr("stroke-width", 2.4), 
  legend.append("text").attr("x", 40).attr("y", 70).text("Net exporter"), legend.append("circle").attr("cx", 25).attr("cy", 86).attr("r", 5.5).attr("fill", "#ffffff").attr("stroke", "#1F3A5F").attr("stroke-width", 2.4), 
  legend.append("text").attr("x", 40).attr("y", 90).text("Balanced role"), legend.append("line").attr("x1", 18).attr("x2", 36).attr("y1", 110).attr("y2", 110).attr("stroke", "#3B82F6").attr("stroke-width", 4), 
  legend.append("text").attr("x", 40).attr("y", 114).text("Focused imports"), legend.append("line").attr("x1", 18).attr("x2", 36).attr("y1", 130).attr("y2", 130).attr("stroke", "#D96C50").attr("stroke-width", 4), 
  legend.append("text").attr("x", 40).attr("y", 134).text("Focused exports"), legend.append("line").attr("x1", 18).attr("x2", 36).attr("y1", 150).attr("y2", 150).attr("stroke", "#1F3A5F").attr("stroke-width", 4), 
  legend.append("text").attr("x", 40).attr("y", 154).text("Balanced partners");
}

function updateFlowNetworkMap(filters) {
  if (!flowSvg) return;
  const subtitle = document.getElementById("flowNetworkSubtitle"), linksLayer = flowSvg.select(".network-links-layer"), nodesLayer = flowSvg.select(".network-nodes-layer"), labelsLayer = flowSvg.select(".network-labels-layer");
  linksLayer.selectAll("*").remove(), nodesLayer.selectAll("*").remove(), labelsLayer.selectAll("*").remove();
  const networkData = buildFlowNetworkData(filters);
  lastNetworkData = networkData;
  const nodes = networkData.nodes, links = networkData.links;
  if (!nodes.length || !links.length) return void (subtitle && (subtitle.textContent = "No flow connections available for the selected time range."));
  subtitle && (subtitle.textContent = `${filters.startLabel} to ${filters.endLabel}. Hover or click a node to simplify the network into imports and exports.`);
  const maxLinkValue = d3.max(links, d => d.value) || 1, maxNodeValue = d3.max(nodes, d => d.totalFlow) || 1, linkWidthScale = d3.scaleSqrt().domain([ 0, maxLinkValue ]).range([ .55, 6.2 ]), linkOpacityScale = d3.scaleSqrt().domain([ 0, maxLinkValue ]).range([ .07, .48 ]), nodeRadiusScale = d3.scaleSqrt().domain([ 0, maxNodeValue ]).range([ 6.5, 25 ]);
  nodes.forEach((node, index) => {
    node.baseRadius = nodeRadiusScale(node.totalFlow), node.isImportant = index < 32, 
    node.balance = node.exports - node.imports, node.balanceRatio = node.totalFlow > 0 ? node.balance / node.totalFlow : 0;
  });
  const backboneCount = Math.max(22, Math.round(.22 * links.length)), backboneIds = new Set(links.slice(0, backboneCount).map(link => link.id));
  links.forEach(link => {
    link.isBackbone = backboneIds.has(link.id);
  }), prepareNetworkLayout(nodes, links), linksLayer.selectAll("path").data(links, d => d.id).join("path").attr("class", d => d.isBackbone ? "network-link backbone" : "network-link").attr("d", createNetworkLinkPath).attr("stroke-width", d => linkWidthScale(d.value)).attr("data-base-width", d => linkWidthScale(d.value)).attr("data-base-opacity", d => linkOpacityScale(d.value)).style("opacity", d => linkOpacityScale(d.value)).on("mousemove", function(event, d) {
    showNetworkLinkTooltip(event, d);
  }).on("mouseleave", function() {
    hideTooltip(), restoreSelectedNetworkFocus();
  }), nodesLayer.selectAll("circle").data(nodes, d => d.id).join("circle").attr("class", d => `network-node ${getNodeBalanceClass(d)}`).attr("cx", d => d.x).attr("cy", d => d.y).attr("r", d => d.baseRadius).on("mouseenter", function(event, d) {
    focusNetworkCountries([ d.id ]), showNetworkNodeTooltip(event, d.id);
  }).on("mousemove", function(event, d) {
    showNetworkNodeTooltip(event, d.id);
  }).on("mouseleave", function() {
    hideTooltip(), restoreSelectedNetworkFocus();
  }).on("click", function(event, d) {
    event.stopPropagation(), setCountryFilterFromNetworkNode(d.id, event.shiftKey);
  }), labelsLayer.selectAll("text").data(nodes, d => d.id).join("text").attr("class", d => d.isImportant ? "network-label important" : "network-label").attr("x", d => d.x).attr("y", d => d.y + 4).text(d => d.id), 
  restoreSelectedNetworkFocus();
}

function buildFlowNetworkData(filters) {
  const nodeMap = new Map, pairMap = new Map;
  return flowData.forEach(row => {
    if (!(row.dateIndex >= filters.startIndex && row.dateIndex <= filters.endIndex)) return;
    const value = row.ValueInGWh;
    if (!Number.isFinite(value) || value <= 0) return;
    if (!row.FromCountry || !row.ToCountry) return;
    if (row.FromCountry === row.ToCountry) return;
    const source = row.FromCountry, target = row.ToCountry;
    nodeMap.has(source) || nodeMap.set(source, createNetworkNode(source)), nodeMap.has(target) || nodeMap.set(target, createNetworkNode(target));
    const sourceNode = nodeMap.get(source), targetNode = nodeMap.get(target);
    sourceNode.exports += value, sourceNode.totalFlow += value, targetNode.imports += value, 
    targetNode.totalFlow += value;
    const countries = [ source, target ].sort(), countryA = countries[0], countryB = countries[1], pairKey = `${countryA}|${countryB}`;
    pairMap.has(pairKey) || pairMap.set(pairKey, {
      id: pairKey,
      source: countryA,
      target: countryB,
      sourceCode: countryA,
      targetCode: countryB,
      countryA: countryA,
      countryB: countryB,
      valueAB: 0,
      valueBA: 0,
      value: 0,
      isBackbone: !1
    });
    const pair = pairMap.get(pairKey);
    source === countryA && target === countryB ? pair.valueAB += value : pair.valueBA += value, 
    pair.value += value;
  }), {
    nodes: [ ...nodeMap.values() ].sort((a, b) => b.totalFlow - a.totalFlow),
    links: [ ...pairMap.values() ].sort((a, b) => b.value - a.value)
  };
}

function createNetworkNode(countryCode) {
  return {
    id: countryCode,
    imports: 0,
    exports: 0,
    totalFlow: 0,
    balance: 0,
    balanceRatio: 0,
    x: 0,
    y: 0,
    anchorX: 0,
    anchorY: 0,
    baseRadius: 8,
    isImportant: !1
  };
}

function getNodeBalanceClass(node) {
  return node.balanceRatio > .08 ? "net-exporter" : node.balanceRatio < -.08 ? "net-importer" : "net-balanced";
}

function prepareNetworkLayout(nodes, links) {
  networkAnchorProjection && networkAnchorPath || (networkAnchorProjection = d3.geoMercator().fitExtent([ [ 95, 62 ], [ 830, 506 ] ], geoData), 
  networkAnchorPath = d3.geoPath().projection(networkAnchorProjection));
  const fallbackRadius = .34 * Math.min(900, 560);
  nodes.forEach((node, index) => {
    const anchorPoint = getNetworkAnchorPoint(node.id);
    if (anchorPoint) node.anchorX = anchorPoint[0], node.anchorY = anchorPoint[1]; else {
      const angle = index / nodes.length * Math.PI * 2;
      node.anchorX = 450 + Math.cos(angle) * fallbackRadius, node.anchorY = 280 + Math.sin(angle) * fallbackRadius;
    }
    node.x = node.anchorX, node.y = node.anchorY;
  });
  const maxLinkValue = d3.max(links, d => d.value) || 1, simulation = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id(d => d.id).distance(d => 160 - 48 * Math.sqrt(d.value / maxLinkValue)).strength(.032)).force("charge", d3.forceManyBody().strength(-165)).force("collision", d3.forceCollide().radius(d => d.baseRadius + 15)).force("x", d3.forceX(d => d.anchorX).strength(.23)).force("y", d3.forceY(d => d.anchorY).strength(.23)).force("center", d3.forceCenter(450, 280)).stop();
  for (let i = 0; i < 280; i++) simulation.tick();
  fitNetworkLayoutToViewport(nodes);
}

function fitNetworkLayoutToViewport(nodes) {
  if (!nodes.length) return;
  const minX = d3.min(nodes, d => d.x) || 0, maxX = d3.max(nodes, d => d.x) || 900, minY = d3.min(nodes, d => d.y) || 0, maxY = d3.max(nodes, d => d.y) || 560, currentWidth = Math.max(1, maxX - minX), currentHeight = Math.max(1, maxY - minY), scale = Math.min(1.18, 728 / currentWidth, 478 / currentHeight), currentCenterX = (minX + maxX) / 2, currentCenterY = (minY + maxY) / 2;
  nodes.forEach(node => {
    node.x = 502 + (node.x - currentCenterX) * scale, node.y = 289 + (node.y - currentCenterY) * scale, 
    node.x = Math.max(34, Math.min(866, node.x)), node.y = Math.max(34, Math.min(526, node.y));
  });
}

function getNetworkAnchorPoint(countryCode) {
  if (!geoData || !geoData.features || !networkAnchorPath) return null;
  const cleanCode = cleanCountryCode(countryCode), feature = geoData.features.find(feature => getGeoCountryCode(feature) === cleanCode);
  if (!feature) return null;
  const point = networkAnchorPath.centroid(feature);
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null;
}

function createNetworkLinkPath(link) {
  const source = link.source, target = link.target, x1 = source.x, y1 = source.y, x2 = target.x, y2 = target.y, dx = x2 - x1, dy = y2 - y1, distance = Math.sqrt(dx * dx + dy * dy);
  if (0 === distance) return `M ${x1},${y1} L ${x2},${y2}`;
  const curveStrength = Math.min(55, .18 * distance);
  return `M ${x1},${y1} Q ${(x1 + x2) / 2 + -dy / distance * curveStrength},${(y1 + y2) / 2 + dx / distance * curveStrength} ${x2},${y2}`;
}

function focusNetworkNode(countryCode) {
  focusNetworkCountries([ countryCode ]);
}

function focusNetworkCountries(countryCodes) {
  if (!lastNetworkData || !flowSvg) return;
  resetNetworkStyles();
  const selectedSet = new Set(countryCodes.map(code => cleanCountryCode(code))), connectedCountries = new Set(selectedSet);
  lastNetworkData.links.forEach(link => {
    (selectedSet.has(link.countryA) || selectedSet.has(link.countryB)) && (connectedCountries.add(link.countryA), 
    connectedCountries.add(link.countryB));
  }), flowSvg.selectAll(".network-link").classed("dimmed", d => !selectedSet.has(d.countryA) && !selectedSet.has(d.countryB)).classed("incoming-highlight", d => "incoming" === getPairRelationForCountrySet(d, selectedSet)).classed("outgoing-highlight", d => "outgoing" === getPairRelationForCountrySet(d, selectedSet)).classed("bidirectional-highlight", d => "balanced" === getPairRelationForCountrySet(d, selectedSet)).attr("stroke-width", function(d) {
    const baseWidth = Number(d3.select(this).attr("data-base-width")) || 1;
    return selectedSet.has(d.countryA) || selectedSet.has(d.countryB) ? baseWidth + 2 : baseWidth;
  }), flowSvg.selectAll(".network-link").filter(d => selectedSet.has(d.countryA) || selectedSet.has(d.countryB)).raise(), 
  flowSvg.selectAll(".network-node").classed("dimmed", d => !connectedCountries.has(d.id)).classed("hovered", d => selectedSet.has(d.id)).classed("neighbor", d => !selectedSet.has(d.id) && connectedCountries.has(d.id)).attr("r", d => selectedSet.has(d.id) ? d.baseRadius + 8 : connectedCountries.has(d.id) ? d.baseRadius + 3 : d.baseRadius), 
  flowSvg.selectAll(".network-label").classed("dimmed", d => !connectedCountries.has(d.id)).classed("highlighted", d => connectedCountries.has(d.id));
}

function getPairRelationForCountrySet(link, countrySet) {
  const aSelected = countrySet.has(link.countryA), bSelected = countrySet.has(link.countryB);
  if (!aSelected && !bSelected) return "none";
  if (aSelected && bSelected) return "balanced";
  let importsToSelection = 0, exportsFromSelection = 0;
  aSelected && (exportsFromSelection += link.valueAB, importsToSelection += link.valueBA), 
  bSelected && (exportsFromSelection += link.valueBA, importsToSelection += link.valueAB);
  const total = exportsFromSelection + importsToSelection;
  if (total <= 0) return "none";
  const ratio = (exportsFromSelection - importsToSelection) / total;
  return ratio > .15 ? "outgoing" : ratio < -.15 ? "incoming" : "balanced";
}

function restoreSelectedNetworkFocus() {
  selectedCountries.size > 0 ? focusNetworkCountries([ ...selectedCountries ]) : clearNetworkFocus();
}

function clearNetworkFocus() {
  resetNetworkStyles();
}

function resetNetworkStyles() {
  flowSvg && (flowSvg.selectAll(".network-link").classed("dimmed", !1).classed("incoming-highlight", !1).classed("outgoing-highlight", !1).classed("bidirectional-highlight", !1).attr("stroke-width", function() {
    return Number(d3.select(this).attr("data-base-width")) || 1;
  }).style("opacity", function() {
    return Number(d3.select(this).attr("data-base-opacity")) || .08;
  }), flowSvg.selectAll(".network-node").classed("dimmed", !1).classed("hovered", !1).classed("neighbor", !1).attr("r", d => d.baseRadius), 
  flowSvg.selectAll(".network-label").classed("dimmed", !1).classed("highlighted", !1));
}

function showNetworkNodeTooltip(event, countryCode) {
  if (!lastNetworkData) return;
  const node = lastNetworkData.nodes.find(item => item.id === countryCode);
  if (!node) return;
  const incoming = getTopNetworkLinks(countryCode, "incoming", 3), outgoing = getTopNetworkLinks(countryCode, "outgoing", 3), incomingHtml = incoming.length ? incoming.map(link => `<li><span>${getShortCountryLabel(link.sourceCode)}</span><strong>${formatNumber(link.value)} GWh</strong></li>`).join("") : "<li><span>No imports</span></li>", outgoingHtml = outgoing.length ? outgoing.map(link => `<li><span>${getShortCountryLabel(link.targetCode)}</span><strong>${formatNumber(link.value)} GWh</strong></li>`).join("") : "<li><span>No exports</span></li>", balance = node.exports - node.imports, role = balance > 0 ? "Net exporter" : balance < 0 ? "Net importer" : "Balanced";
  d3.select("#tooltip").style("opacity", 1).html(`\n      <strong>${getDisplayCountry(countryCode)}</strong>\n      <div class="tooltip-muted">${role}</div>\n\n      <div class="tooltip-stat-grid">\n        <div><span>Imports</span><strong>${formatNumber(node.imports)} GWh</strong></div>\n        <div><span>Exports</span><strong>${formatNumber(node.exports)} GWh</strong></div>\n        <div><span>Balance</span><strong>${formatSignedNumber(balance)} GWh</strong></div>\n      </div>\n\n      <div class="tooltip-two-columns">\n        <div>\n          <strong>Top imports</strong>\n          <ul>${incomingHtml}</ul>\n        </div>\n        <div>\n          <strong>Top exports</strong>\n          <ul>${outgoingHtml}</ul>\n        </div>\n      </div>\n\n      <div class="tooltip-muted">Click to lock. Shift + click to add. Empty click resets.</div>\n    `).style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
}

function showNetworkLinkTooltip(event, link) {
  d3.select("#tooltip").style("opacity", 1).html(`\n      <strong>Electricity exchange</strong>\n      <div class="tooltip-stat-grid two">\n        <div><span>${getShortCountryLabel(link.countryA)} → ${getShortCountryLabel(link.countryB)}</span><strong>${formatNumber(link.valueAB)} GWh</strong></div>\n        <div><span>${getShortCountryLabel(link.countryB)} → ${getShortCountryLabel(link.countryA)}</span><strong>${formatNumber(link.valueBA)} GWh</strong></div>\n      </div>\n      <div class="tooltip-muted">Total exchange: ${formatNumber(link.value)} GWh</div>\n    `).style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
}

function getTopNetworkLinks(countryCode, direction, limit) {
  if (!lastNetworkData) return [];
  const cleanCode = cleanCountryCode(countryCode);
  return lastNetworkData.links.map(link => {
    if (link.countryA !== cleanCode && link.countryB !== cleanCode) return null;
    let partner = null, incomingValue = 0, outgoingValue = 0;
    return cleanCode === link.countryA && (partner = link.countryB, outgoingValue = link.valueAB, 
    incomingValue = link.valueBA), cleanCode === link.countryB && (partner = link.countryA, 
    outgoingValue = link.valueBA, incomingValue = link.valueAB), {
      partner: partner,
      incomingValue: incomingValue,
      outgoingValue: outgoingValue,
      link: link
    };
  }).filter(item => null !== item).map(item => "incoming" === direction ? {
    sourceCode: item.partner,
    targetCode: cleanCode,
    value: item.incomingValue
  } : {
    sourceCode: cleanCode,
    targetCode: item.partner,
    value: item.outgoingValue
  }).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
}

function setCountryFilterFromNetworkNode(countryCode, additive) {
  const countryFilter = document.getElementById("countryFilter");
  if (!countryFilter) return;
  const cleanCode = cleanCountryCode(countryCode);
  [ ...countryFilter.options ].some(option => option.value === cleanCode) && (updateCountrySelection(cleanCode, additive), 
  updateDashboard());
}

function clearCountrySelectionFromMap() {
  selectedCountries.clear(), syncCountryFilterWithSelectedCountries(), hideTooltip(), 
  updateDashboard();
}

function clearCountrySelectionFromNetwork() {
  selectedCountries.clear(), syncCountryFilterWithSelectedCountries(), updateDashboard();
}


/* ---------- Global dashboard update cycle ---------- */
function updateDashboard() {
  const filters = getFilters();
  updateKpis(filters), updateMap(filters), updateTitles(filters), updatePowerFlowView(filters), 
  updateGenerationInsight(filters), updateSidebarInfoPanel(filters);
}

function updateKpis(filters) {
  const aggregatedByCountry = aggregateGenerationByCountry(generationData, filters), selectedSet = getCountrySet(filters), visibleEntries = [ ...aggregatedByCountry.values() ].filter(entry => 0 === selectedSet.size || selectedSet.has(entry.country)), totalGWh = visibleEntries.reduce((sum, entry) => sum + entry.valueGwh, 0), countriesWithDataCount = visibleEntries.filter(entry => entry.valueGwh > 0).length, shareValue = average(visibleEntries.map(entry => entry.selectedValue)), selectedTotal = document.getElementById("selectedTotal"), countriesWithData = document.getElementById("countriesWithData"), selectedSource = document.getElementById("selectedSource"), selectedMetricElement = document.getElementById("selectedMetric");
  selectedTotal && (selectedTotal.textContent = "ValueInGWh" === filters.metric ? `${formatNumber(totalGWh)} GWh` : `${formatNumber(shareValue)}% avg`), 
  countriesWithData && (countriesWithData.textContent = countriesWithDataCount), selectedSource && (selectedSource.textContent = getReadableEnergySelection(filters.energySelection)), 
  selectedMetricElement && (selectedMetricElement.textContent = "ValueInGWh" === filters.metric ? "GWh" : "%");
}

function updateTitles(filters) {
  const readableEnergy = getReadableEnergySelection(filters.energySelection), countryContext = getCountrySelectionLabel(filters), mapTitle = document.getElementById("mapTitle"), mapSubtitle = document.getElementById("mapSubtitle");
  mapTitle && (mapTitle.textContent = `European Choropleth Map - ${readableEnergy}`), 
  mapSubtitle && (mapSubtitle.textContent = `${filters.startLabel} to ${filters.endLabel}, shown as ${"ValueInGWh" === filters.metric ? "absolute generation in GWh" : "average relative share in %"}. Country filter: ${countryContext}.`);
}

function updateSidebarInfoPanel(filters) {
  const infoPanel = document.querySelector(".sidebar .panel:last-child");
  infoPanel && (infoPanel.querySelector("select, input, button, .timeline-filter, #resetFilters") || (getCountrySelectionLabel(filters), 
  getReadableEnergySelection(filters.energySelection), filters.metric, infoPanel.classList.add("interaction-tip-panel"), 
  infoPanel.innerHTML = '\n    <div class="filter-tip-card">\n      <span class="filter-tip-kicker">Interaction tip</span>\n      <p id="rotatingFilterTip"></p>\n      <div id="filterTipDots" class="filter-tip-dots"></div>\n    </div>\n  ', 
  updateSidebarTipText(), startSidebarTipRotation()));
}

function getSidebarTips() {
  return [ "Hover a country node to fade unrelated links and inspect only its direct exchange partners.", "Click a country to lock the focus. Click the empty background to return to all countries.", "Use Shift + Click on the map or network nodes to compare multiple countries as one group.", "In the flow network, blue highlights mean imports or orange highlights mean exports from a country.", "Node outlines show the role of a country: blue (net importer), orange (net exporter) or balanced.", "Use GWh for absolute generation values and % for average monthly shares in the generation map.", "With multiple selected countries, internal flows inside selection are ignored for import/export balance." ];
}

function updateSidebarTipText() {
  const tipElement = document.getElementById("rotatingFilterTip"), dotsElement = document.getElementById("filterTipDots");
  if (!tipElement || !dotsElement) return;
  const tips = getSidebarTips(), safeIndex = sidebarTipIndex % tips.length;
  tipElement.textContent = tips[safeIndex], dotsElement.innerHTML = "", tips.forEach((tip, index) => {
    const dot = document.createElement("span");
    dot.className = index === safeIndex ? "active" : "", dotsElement.appendChild(dot);
  });
}

function startSidebarTipRotation() {
  sidebarTipTimer || (sidebarTipTimer = window.setInterval(() => {
    sidebarTipIndex = (sidebarTipIndex + 1) % getSidebarTips().length, updateSidebarTipText();
  }, 6500));
}


/* ---------- Generic helpers ---------- */
function buildCountryNameLookup() {
  countryNameLookup = new Map, geoData && geoData.features && geoData.features.forEach(feature => {
    const code = getGeoCountryCode(feature), name = getGeoCountryName(feature);
    code && name && countryNameLookup.set(code, name);
  });
}

function getGeoCountryCode(feature) {
  return cleanCountryCode(feature.properties.ISO2 || feature.properties.ISO_A2 || feature.properties.CNTR_ID || feature.properties.iso_a2 || feature.id);
}

function getGeoCountryName(feature) {
  return feature.properties.NAME || feature.properties.NAME_ENGL || feature.properties.ADMIN || feature.properties.name || "Unknown";
}

function getDisplayCountry(code) {
  const cleanCode = cleanCountryCode(code), name = countryNameLookup.get(cleanCode);
  return name && name !== cleanCode ? `${name} (${cleanCode})` : cleanCode;
}

function getShortCountryLabel(code) {
  return cleanCountryCode(code);
}

function pickValue(row, keys) {
  for (const key of keys) if (void 0 !== row[key] && null !== row[key]) return row[key];
  return null;
}

function cleanText(value) {
  return null == value ? "" : String(value).trim();
}

function cleanCountryCode(value) {
  const text = cleanText(value).toUpperCase();
  return text ? countryCodeAliases[text] || text : "";
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function uniqueSorted(values) {
  return [ ...new Set(values) ].filter(value => null != value && "" !== value).sort((a, b) => "number" == typeof a && "number" == typeof b ? a - b : String(a).localeCompare(String(b)));
}

function fillSelect(id, values, labelFunction = value => value) {
  const select = document.getElementById(id);
  select && (select.innerHTML = "", values.forEach(value => {
    const option = document.createElement("option");
    option.value = value, option.textContent = labelFunction(value), select.appendChild(option);
  }));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

function formatSignedNumber(value) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(value));
  return 0 === valid.length ? 0 : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function showError(message) {
  const selectedTotal = document.getElementById("selectedTotal"), countriesWithData = document.getElementById("countriesWithData"), selectedSource = document.getElementById("selectedSource"), selectedMetricElement = document.getElementById("selectedMetric"), totalImports = document.getElementById("totalImports"), totalExports = document.getElementById("totalExports"), netBalance = document.getElementById("netBalance"), map = document.getElementById("map");
  selectedTotal && (selectedTotal.textContent = "Error"), countriesWithData && (countriesWithData.textContent = "-"), 
  selectedSource && (selectedSource.textContent = "-"), selectedMetricElement && (selectedMetricElement.textContent = "-"), 
  totalImports && (totalImports.textContent = "-"), totalExports && (totalExports.textContent = "-"), 
  netBalance && (netBalance.textContent = "-"), map && (map.innerHTML = `\n      <div style="padding: 24px; color: #D96C50;">\n        <strong>Loading error:</strong><br>\n        ${message}<br><br>\n        Check if you are using Live Server or GitHub Pages.\n      </div>\n    `);
}


/* ---------- Monthly generation pattern ---------- */
function updateGenerationInsight(filters) {
  const container = document.getElementById("generationSeasonChart"), subtitle = document.getElementById("generationSeasonSubtitle");
  if (!container) return;
  const selectedSet = getCountrySet(filters), monthMap = new Map;
  for (let month = 1; month <= 12; month += 1) monthMap.set(month, {
    month: month,
    selectedGwh: 0,
    totalGwh: 0,
    periodCount: new Set
  });
  generationData.forEach(row => {
    const timeMatch = row.dateIndex >= filters.startIndex && row.dateIndex <= filters.endIndex, countryMatch = 0 === selectedSet.size || selectedSet.has(row.Country);
    if (!timeMatch || !countryMatch || row.ValueInGWh <= 0) return;
    const entry = monthMap.get(row.Month), periodKey = `${row.Year}-${row.Month}`;
    entry.totalGwh += row.ValueInGWh, entry.periodCount.add(periodKey), matchesEnergySelection(row, filters.energySelection) && (entry.selectedGwh += row.ValueInGWh);
  });
  const data = [ ...monthMap.values() ].map(entry => {
    const divisor = Math.max(1, entry.periodCount.size), monthlyGwh = entry.selectedGwh / divisor, monthlyShare = entry.totalGwh > 0 ? entry.selectedGwh / entry.totalGwh * 100 : 0;
    return {
      month: entry.month,
      label: monthNames[entry.month].slice(0, 3),
      value: "ValueInGWh" === filters.metric ? monthlyGwh : monthlyShare,
      gwh: monthlyGwh,
      share: monthlyShare
    };
  });
  if (subtitle && (subtitle.textContent = `${getReadableEnergySelection(filters.energySelection)}, ${filters.startLabel} to ${filters.endLabel}. ${getCountrySelectionLabel(filters)}.`), 
  container.innerHTML = "", !data.some(item => item.value > 0)) return void (container.innerHTML = '<div class="generation-empty">No monthly pattern available for the selected filter.</div>');
  const svgChart = d3.select(container).append("svg").attr("viewBox", "0 0 820 210").attr("preserveAspectRatio", "xMidYMid meet"), x = d3.scalePoint().domain(data.map(item => item.label)).range([ 56, 796 ]).padding(.5), yMax = d3.max(data, item => item.value) || 1, y = d3.scaleLinear().domain([ 0, yMax ]).nice().range([ 176, 16 ]), area = d3.area().x(item => x(item.label)).y0(176).y1(item => y(item.value)).curve(d3.curveMonotoneX), line = d3.line().x(item => x(item.label)).y(item => y(item.value)).curve(d3.curveMonotoneX);
  svgChart.append("path").datum(data).attr("class", "season-area").attr("d", area), 
  svgChart.append("path").datum(data).attr("class", "season-line").attr("d", line), 
  svgChart.append("g").attr("class", "season-axis").attr("transform", "translate(0,176)").call(d3.axisBottom(x).tickSize(0)), 
  svgChart.append("g").attr("class", "season-axis").attr("transform", "translate(56,0)").call(d3.axisLeft(y).ticks(4).tickSize(-740).tickFormat(value => "ValueInGWh" === filters.metric ? formatNumber(value) : `${formatNumber(value)}%`)), 
  svgChart.selectAll(".season-point").data(data).join("circle").attr("class", "season-point").attr("cx", item => x(item.label)).attr("cy", item => y(item.value)).attr("r", 4.2).on("mousemove", function(event, item) {
    const valueLabel = "ValueInGWh" === filters.metric ? `${formatNumber(item.value)} GWh avg` : `${formatNumber(item.value)}% share`;
    d3.select("#tooltip").style("opacity", 1).html(`\n          <strong>${monthNames[item.month]}</strong><br>\n          ${getReadableEnergySelection(filters.energySelection)}: ${valueLabel}<br>\n          Average generation: ${formatNumber(item.gwh)} GWh\n        `).style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
  }).on("mouseleave", hideTooltip);
  const unit = "ValueInGWh" === filters.metric ? "GWh avg" : "% share";
  d3.select(container).append("div").attr("class", "season-caption").text(`Highest month: ${monthNames[data.reduce((best, item) => item.value > best.value ? item : best, data[0]).month]} (${formatNumber(d3.max(data, item => item.value))} ${unit})`);
}

document.addEventListener("DOMContentLoaded", init);
