const GENERATION_URL = "data/entsoe_domestic_generation_2019_2025.json";
const FLOWS_URL = "data/entsoe_power_flows_2019_2025.json";
const GEO_URL = "data/europe.geojson";

let generationData = [];
let flowData = [];
let geoData = null;

let svg = null;
let path = null;

let flowSvg = null;
let lastNetworkData = null;
let networkAnchorProjection = null;
let networkAnchorPath = null;

let selectedMetric = "ShareIn%";
let selectedCountries = new Set();
let timePeriods = [];
let countryNameLookup = new Map();
let sidebarTipIndex = 0;
let sidebarTipTimer = null;

const mapWidth = 900;
const mapHeight = 610;

const flowMapWidth = 900;
const flowMapHeight = 560;

const monthNames = {
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
};

const renewableSources = [
  "Biomass",
  "Biomass / Biogas",
  "Geothermal",
  "Hydro Pumped Storage",
  "Hydro Run-of-river and poundage",
  "Hydro Run-Of-River And Poundage",
  "Hydro Water Reservoir",
  "Marine",
  "Other renewable",
  "Other Renewable",
  "Solar",
  "Waste",
  "Wind Offshore",
  "Wind Onshore"
];

const fossilSources = [
  "Fossil Brown coal/Lignite",
  "Fossil Brown Coal/Lignite",
  "Fossil Brown Coal Lignite",
  "Fossil Coal-derived gas",
  "Fossil Coal Derived Gas",
  "Fossil Gas",
  "Fossil Hard coal",
  "Fossil Hard Coal",
  "Fossil Oil",
  "Fossil Oil shale",
  "Fossil Oil Shale",
  "Fossil Peat"
];

const countryCodeAliases = {
  UK: "GB",
  EL: "GR"
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [generationResponse, flowsResponse, geoResponse] = await Promise.all([
      fetch(GENERATION_URL),
      fetch(FLOWS_URL),
      fetch(GEO_URL)
    ]);

    if (!generationResponse.ok) {
      throw new Error(`Could not load generation file: ${GENERATION_URL}`);
    }

    if (!flowsResponse.ok) {
      throw new Error(`Could not load flow file: ${FLOWS_URL}`);
    }

    if (!geoResponse.ok) {
      throw new Error(`Could not load geo file: ${GEO_URL}`);
    }

    const rawGenerationData = await generationResponse.json();
    const rawFlowData = await flowsResponse.json();
    geoData = await geoResponse.json();

    buildCountryNameLookup();

    generationData = deduplicateEnergyRows(
      normalizeGenerationData(rawGenerationData)
    );

    flowData = deduplicateFlowRows(
      normalizeFlowData(rawFlowData)
    );

    console.log("Generation rows after cleaning:", generationData.length);
    console.log("Flow rows after cleaning:", flowData.length);
    console.log("Example generation row:", generationData[0]);
    console.log("Example flow row:", flowData[0]);
    console.log("Example geo properties:", geoData.features[0].properties);

    setupFilters();
    drawMap();
    drawFlowNetworkMap();
    updateDashboard();
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

/* -------------------------------------------------------
   DATA NORMALIZATION
------------------------------------------------------- */

function normalizeGenerationData(rawData) {
  let rows = rawData;

  if (!Array.isArray(rawData)) {
    const firstKey = Object.keys(rawData)[0];
    rows = rawData[firstKey];
  }

  return rows.map(row => {
    const month = toNumber(pickValue(row, ["Month", "month"]));
    const year = toNumber(pickValue(row, ["Year", "year"]));

    return {
      Month: month,
      Year: year,
      dateIndex: year * 12 + month,
      Country: cleanCountryCode(pickValue(row, ["Country", "country"])),
      EnergySourceID: cleanText(
        pickValue(row, ["EnergySourceID", "energy_source_id"])
      ),
      EnergySource: cleanText(
        pickValue(row, ["EnergySource", "energy_source"])
      ),
      ValueInGWh: toNumber(
        pickValue(row, ["ValueInGWh", "value_gwh", "Value in GWh"])
      ),
      "ShareIn%": toNumber(
        pickValue(row, ["ShareIn%", "share_percent", "ShareInPercent"])
      )
    };
  });
}

function normalizeFlowData(rawData) {
  let rows = rawData;

  if (!Array.isArray(rawData)) {
    const firstKey = Object.keys(rawData)[0];
    rows = rawData[firstKey];
  }

  return rows.map(row => {
    const month = toNumber(pickValue(row, ["Month", "month"]));
    const year = toNumber(pickValue(row, ["Year", "year"]));

    return {
      Month: month,
      Year: year,
      dateIndex: year * 12 + month,

      FromCountry: cleanCountryCode(
        pickValue(row, [
          "FromCountry",
          "from_country",
          "From Country",
          "from country",
          "FromCountryMapCode",
          "From Country Map Code"
        ])
      ),

      ToCountry: cleanCountryCode(
        pickValue(row, [
          "ToCountry",
          "to_country",
          "To Country",
          "to country",
          "ToCountryMapCode",
          "To Country Map Code"
        ])
      ),

      FlowDirection: cleanText(
        pickValue(row, [
          "FlowDirection",
          "flow_direction",
          "Direction",
          "direction"
        ])
      ),

      ValueInGWh: toNumber(
        pickValue(row, [
          "ValueInGWh",
          "value_gwh",
          "Value in GWh",
          "Provided Value in GWh",
          "provided value in gwh"
        ])
      )
    };
  }).filter(row =>
    Number.isFinite(row.Year) &&
    Number.isFinite(row.Month) &&
    row.Month >= 1 &&
    row.Month <= 12 &&
    row.FromCountry &&
    row.ToCountry
  );
}

function deduplicateEnergyRows(rows) {
  const seen = new Map();
  let duplicateCount = 0;

  rows.forEach(row => {
    if (
      !Number.isFinite(row.Year) ||
      !Number.isFinite(row.Month) ||
      row.Month < 1 ||
      row.Month > 12 ||
      !row.Country ||
      !row.EnergySource
    ) {
      return;
    }

    const key = [
      row.Country,
      row.Year,
      row.Month,
      row.EnergySourceID || row.EnergySource
    ].join("|");

    if (!seen.has(key)) {
      seen.set(key, row);
    } else {
      duplicateCount += 1;

      const existing = seen.get(key);

      if (
        (existing.ValueInGWh === 0 || !Number.isFinite(existing.ValueInGWh)) &&
        row.ValueInGWh > 0
      ) {
        seen.set(key, row);
      }
    }
  });

  if (duplicateCount > 0) {
    console.warn(`Removed ${duplicateCount} duplicate generation rows.`);
  }

  return [...seen.values()];
}

function deduplicateFlowRows(rows) {
  const seen = new Map();
  let duplicateCount = 0;

  rows.forEach(row => {
    const key = [
      row.FromCountry,
      row.ToCountry,
      row.Year,
      row.Month,
      row.FlowDirection,
      row.ValueInGWh
    ].join("|");

    if (!seen.has(key)) {
      seen.set(key, row);
    } else {
      duplicateCount += 1;
    }
  });

  if (duplicateCount > 0) {
    console.warn(`Removed ${duplicateCount} exact duplicate flow rows.`);
  }

  return [...seen.values()];
}

/* -------------------------------------------------------
   FILTER SETUP
------------------------------------------------------- */

function setupFilters() {
  setupTimeRangeFilter();
  setupCountryFilter();
  setupEnergySourceFilter();
  setupMetricToggle();

  const resetButton = document.getElementById("resetFilters");

  if (resetButton) {
    resetButton.addEventListener("click", resetFilters);
    setupCompactFilterHeader(resetButton);
  }
}

function setupCompactFilterHeader(resetButton) {
  const filterPanel = document.querySelector(".sidebar .panel:first-child");

  if (!filterPanel || !resetButton) return;

  const title = filterPanel.querySelector("h2");

  if (!title) return;

  resetButton.classList.add("icon-reset");
  resetButton.setAttribute("title", "Reset filters");
  resetButton.setAttribute("aria-label", "Reset filters");
  resetButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 6h10M4 12h7M4 18h10"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M17 9l4 4M21 9l-4 4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  `;

  let heading = filterPanel.querySelector(".filter-panel-heading");

  if (!heading) {
    heading = document.createElement("div");
    heading.className = "filter-panel-heading";
    filterPanel.insertBefore(heading, title);
    heading.appendChild(title);
  }

  heading.appendChild(resetButton);
}

function setupTimeRangeFilter() {
  timePeriods = uniqueSorted(generationData.map(d => d.dateIndex)).map(index => {
    const year = Math.floor((index - 1) / 12);
    const month = index - year * 12;

    return {
      index,
      year,
      month,
      label: `${monthNames[month]} ${year}`
    };
  });

  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  if (!startSlider || !endSlider) {
    console.warn("Timeline slider elements not found.");
    return;
  }

  startSlider.min = 0;
  startSlider.max = timePeriods.length - 1;
  startSlider.value = 0;

  endSlider.min = 0;
  endSlider.max = timePeriods.length - 1;
  endSlider.value = timePeriods.length - 1;

  startSlider.addEventListener("input", () => {
    if (Number(startSlider.value) > Number(endSlider.value)) {
      startSlider.value = endSlider.value;
    }

    updateTimeLabels();
    updateDashboard();
  });

  endSlider.addEventListener("input", () => {
    if (Number(endSlider.value) < Number(startSlider.value)) {
      endSlider.value = startSlider.value;
    }

    updateTimeLabels();
    updateDashboard();
  });

  const wholeYearButton = document.getElementById("wholeYearBtn");
  const singleMonthButton = document.getElementById("singleMonthBtn");
  const fullRangeButton = document.getElementById("fullRangeBtn");

  if (wholeYearButton) {
    wholeYearButton.addEventListener("click", selectWholeYear);
  }

  if (singleMonthButton) {
    singleMonthButton.addEventListener("click", selectSingleMonth);
  }

  if (fullRangeButton) {
    fullRangeButton.addEventListener("click", selectFullRange);
  }

  createTimelineTicks();
  updateTimeLabels();
}

function selectWholeYear() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  const currentEndIndex = Number(endSlider.value);
  const currentYear = timePeriods[currentEndIndex].year;

  const periodsInYear = timePeriods
    .map((period, sliderIndex) => ({
      ...period,
      sliderIndex
    }))
    .filter(period => period.year === currentYear);

  if (periodsInYear.length === 0) return;

  startSlider.value = periodsInYear[0].sliderIndex;
  endSlider.value = periodsInYear[periodsInYear.length - 1].sliderIndex;

  updateTimeLabels();
  updateDashboard();
}

function selectSingleMonth() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  startSlider.value = endSlider.value;

  updateTimeLabels();
  updateDashboard();
}

function selectFullRange() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  startSlider.value = 0;
  endSlider.value = timePeriods.length - 1;

  updateTimeLabels();
  updateDashboard();
}

function updateTimeLabels() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  const startDateLabel = document.getElementById("startDateLabel");
  const endDateLabel = document.getElementById("endDateLabel");

  if (!startSlider || !endSlider || !startDateLabel || !endDateLabel) return;

  const startIndex = Number(startSlider.value);
  const endIndex = Number(endSlider.value);

  startDateLabel.textContent = timePeriods[startIndex]?.label || "-";
  endDateLabel.textContent = timePeriods[endIndex]?.label || "-";

  updateTimelineVisual();
}

function updateTimelineVisual() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");
  const selection = document.getElementById("timelineSelection");

  if (!startSlider || !endSlider || !selection || timePeriods.length <= 1) return;

  const startValue = Number(startSlider.value);
  const endValue = Number(endSlider.value);
  const max = timePeriods.length - 1;

  const leftPercent = (startValue / max) * 100;
  const rightPercent = (endValue / max) * 100;

  selection.style.left = `${leftPercent}%`;
  selection.style.width = `${rightPercent - leftPercent}%`;
}

function createTimelineTicks() {
  const tickContainer = document.getElementById("timelineTicks");

  if (!tickContainer || timePeriods.length <= 1) return;

  tickContainer.innerHTML = "";

  const max = timePeriods.length - 1;
  const yearTicks = [];

  timePeriods.forEach((period, index) => {
    const isFirstPeriod = index === 0;
    const isJanuary = period.month === 1;

    if (isFirstPeriod || isJanuary) {
      yearTicks.push({
        ...period,
        sliderIndex: index
      });
    }
  });

  const maxVisibleLabels = 5;
  const labelStep = Math.ceil(yearTicks.length / maxVisibleLabels);

  yearTicks.forEach((period, index) => {
    const tick = document.createElement("span");
    tick.className = "timeline-tick tick-major";

    const left = (period.sliderIndex / max) * 100;
    tick.style.left = `${left}%`;

    const shouldShowLabel =
      index === 0 ||
      index === yearTicks.length - 1 ||
      index % labelStep === 0;

    tick.textContent = shouldShowLabel ? period.year : "";
    tickContainer.appendChild(tick);
  });
}

function setupCountryFilter() {
  const generationCountries = generationData.map(d => d.Country);
  const flowCountries = flowData.flatMap(d => [d.FromCountry, d.ToCountry]);

  const countries = uniqueSorted([...generationCountries, ...flowCountries]);

  fillSelect("countryFilter", ["all", ...countries], value => {
    return value === "all" ? "All Countries" : getDisplayCountry(value);
  });

  const countryFilter = document.getElementById("countryFilter");

  if (countryFilter) {
    countryFilter.value = "all";
    countryFilter.addEventListener("change", () => {
      selectedCountries.clear();

      if (countryFilter.value !== "all") {
        selectedCountries.add(countryFilter.value);
      }

      updateDashboard();
    });
  }
}

function setupEnergySourceFilter() {
  const select = document.getElementById("energySourceFilter");

  if (!select) {
    console.warn("Energy source filter not found.");
    return;
  }

  select.innerHTML = "";

  const groupOptions = [
    { value: "group:all", label: "All energy sources" },
    { value: "group:renewable", label: "Renewables" },
    { value: "group:fossil", label: "Fossil fuels" }
  ];

  groupOptions.forEach(item => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  const singleGroup = document.createElement("optgroup");
  singleGroup.label = "Single energy sources";

  const energySources = uniqueSorted(generationData.map(d => d.EnergySource));

  energySources.forEach(source => {
    const option = document.createElement("option");
    option.value = `source:${source}`;
    option.textContent = source;
    singleGroup.appendChild(option);
  });

  select.appendChild(singleGroup);

  select.value = "group:renewable";
  select.addEventListener("change", updateDashboard);
}

function setupMetricToggle() {
  selectedMetric = "ShareIn%";
  updateMetricButtons();

  document.querySelectorAll("#metricToggle button").forEach(button => {
    button.addEventListener("click", () => {
      selectedMetric = button.dataset.metric;
      updateMetricButtons();
      updateDashboard();
    });
  });
}

function updateMetricButtons() {
  document.querySelectorAll("#metricToggle button").forEach(button => {
    button.classList.toggle("active", button.dataset.metric === selectedMetric);
  });
}

function resetFilters() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");
  const countryFilter = document.getElementById("countryFilter");
  const energySourceFilter = document.getElementById("energySourceFilter");

  if (startSlider && endSlider) {
    startSlider.value = 0;
    endSlider.value = timePeriods.length - 1;
  }

  selectedCountries.clear();

  if (countryFilter) {
    countryFilter.value = "all";
  }

  if (energySourceFilter) {
    energySourceFilter.value = "group:renewable";
  }

  selectedMetric = "ShareIn%";

  updateMetricButtons();
  updateTimeLabels();
  updateDashboard();
}

function getFilters() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  const startSliderIndex = startSlider ? Number(startSlider.value) : 0;
  const endSliderIndex = endSlider ? Number(endSlider.value) : timePeriods.length - 1;

  const startPeriod = timePeriods[startSliderIndex];
  const endPeriod = timePeriods[endSliderIndex];

  const countries = [...selectedCountries];

  return {
    startIndex: startPeriod?.index,
    endIndex: endPeriod?.index,
    startLabel: startPeriod?.label || "-",
    endLabel: endPeriod?.label || "-",
    country:
      countries.length === 0
        ? "all"
        : countries.length === 1
          ? countries[0]
          : "multiple",
    countries,
    energySelection: document.getElementById("energySourceFilter")?.value || "group:renewable",
    metric: selectedMetric
  };
}

/* -------------------------------------------------------
   COUNTRY SELECTION HELPERS
------------------------------------------------------- */

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

  if (!countryFilter) return;

  if (selectedCountries.size === 1) {
    const country = [...selectedCountries][0];
    const hasOption = [...countryFilter.options].some(option => option.value === country);
    countryFilter.value = hasOption ? country : "all";
  } else {
    countryFilter.value = "all";
  }
}

function updateCountrySelection(countryCode, additive) {
  const cleanCode = cleanCountryCode(countryCode);

  if (!cleanCode) return;

  if (additive) {
    if (selectedCountries.has(cleanCode)) {
      selectedCountries.delete(cleanCode);
    } else {
      selectedCountries.add(cleanCode);
    }
  } else {
    if (selectedCountries.size === 1 && selectedCountries.has(cleanCode)) {
      selectedCountries.clear();
    } else {
      selectedCountries.clear();
      selectedCountries.add(cleanCode);
    }
  }

  syncCountryFilterWithSelectedCountries();
}

function getCountrySelectionLabel(filters) {
  const countries = filters.countries || [];

  if (countries.length === 0) {
    return "All countries";
  }

  if (countries.length === 1) {
    return getDisplayCountry(countries[0]);
  }

  return `${countries.length} selected countries`;
}

/* -------------------------------------------------------
   ENERGY SOURCE GROUPING
------------------------------------------------------- */

function matchesEnergySelection(row, selection) {
  if (selection === "group:all") {
    return true;
  }

  if (selection === "group:renewable") {
    return renewableSources.includes(row.EnergySource);
  }

  if (selection === "group:fossil") {
    return fossilSources.includes(row.EnergySource);
  }

  if (selection.startsWith("source:")) {
    const source = selection.replace("source:", "");
    return row.EnergySource === source;
  }

  return false;
}

function getReadableEnergySelection(selection) {
  if (selection === "group:all") return "All energy sources";
  if (selection === "group:renewable") return "Renewables";
  if (selection === "group:fossil") return "Fossil fuels";

  if (selection.startsWith("source:")) {
    return selection.replace("source:", "");
  }

  return selection;
}

/* -------------------------------------------------------
   GENERATION MAP
------------------------------------------------------- */

function drawMap() {
  const container = document.getElementById("map");

  if (!container) {
    console.warn("Map container not found.");
    return;
  }

  container.innerHTML = "";

  svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const projection = d3.geoMercator();
  path = d3.geoPath().projection(projection);

  projection.fitSize([mapWidth, mapHeight], geoData);

  svg.append("rect")
    .attr("class", "map-background-click")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", mapWidth)
    .attr("height", mapHeight)
    .attr("fill", "transparent")
    .style("pointer-events", "all")
    .on("click", clearCountrySelectionFromMap);

  svg.append("g")
    .attr("class", "countries")
    .selectAll("path")
    .data(geoData.features)
    .join("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", "#d1d5db")
    .on("mousemove", onCountryHover)
    .on("mouseleave", hideTooltip)
    .on("click", onCountryClick);
}

function updateMap(filters) {
  if (!svg) return;

  const aggregatedByCountry = aggregateGenerationByCountry(generationData, filters);
  const selectedSet = getCountrySet(filters);

  const values = [...aggregatedByCountry.values()]
    .map(row => row.selectedValue)
    .filter(value => Number.isFinite(value) && value > 0);

  const maxValue = d3.max(values) || 1;

  const colorScale = d3.scaleLinear()
    .domain([0, maxValue])
    .range(["#DCEBFF", "#1F3A5F"]);

  svg.selectAll(".country")
    .transition()
    .duration(250)
    .attr("fill", feature => {
      const code = getGeoCountryCode(feature);
      const row = aggregatedByCountry.get(code);

      if (!row || row.selectedValue <= 0) {
        return "#d1d5db";
      }

      if (selectedSet.size > 0 && !selectedSet.has(code)) {
        return "#e5e7eb";
      }

      return colorScale(row.selectedValue);
    });

  svg.selectAll(".country")
    .classed("selected", feature => {
      const code = getGeoCountryCode(feature);
      return selectedSet.has(code);
    })
    .each(function(feature) {
      const code = getGeoCountryCode(feature);
      this.__energyRow = aggregatedByCountry.get(code) || null;
      this.__filters = filters;
    });

  const unit = filters.metric === "ValueInGWh" ? "GWh" : "%";
  const legendMax = document.getElementById("legendMax");

  if (legendMax) {
    legendMax.textContent = `Max: ${formatNumber(maxValue)} ${unit}`;
  }
}

function aggregateGenerationByCountry(allRows, filters) {
  const countryMonthMap = new Map();

  allRows.forEach(row => {
    const timeMatch =
      row.dateIndex >= filters.startIndex &&
      row.dateIndex <= filters.endIndex;

    if (!timeMatch) return;

    const key = `${row.Country}-${row.Year}-${row.Month}`;

    if (!countryMonthMap.has(key)) {
      countryMonthMap.set(key, {
        country: row.Country,
        year: row.Year,
        month: row.Month,
        totalGwh: 0,
        selectedGwh: 0
      });
    }

    const entry = countryMonthMap.get(key);

    entry.totalGwh += row.ValueInGWh;

    if (matchesEnergySelection(row, filters.energySelection)) {
      entry.selectedGwh += row.ValueInGWh;
    }
  });

  const countryMap = new Map();

  countryMonthMap.forEach(monthEntry => {
    if (monthEntry.totalGwh <= 0) return;

    if (!countryMap.has(monthEntry.country)) {
      countryMap.set(monthEntry.country, {
        country: monthEntry.country,
        valueGwh: 0,
        monthlyShares: [],
        selectedValue: 0
      });
    }

    const countryEntry = countryMap.get(monthEntry.country);

    const monthlyShare = (monthEntry.selectedGwh / monthEntry.totalGwh) * 100;
    const safeMonthlyShare = Math.max(0, Math.min(100, monthlyShare));

    countryEntry.valueGwh += monthEntry.selectedGwh;
    countryEntry.monthlyShares.push(safeMonthlyShare);
  });

  countryMap.forEach(countryEntry => {
    if (filters.metric === "ValueInGWh") {
      countryEntry.selectedValue = countryEntry.valueGwh;
    } else {
      countryEntry.selectedValue = average(countryEntry.monthlyShares);
    }
  });

  return countryMap;
}

function onCountryHover(event, feature) {
  const code = getGeoCountryCode(feature);
  const name = getGeoCountryName(feature);
  const row = this.__energyRow;
  const filters = this.__filters || getFilters();

  const tooltip = d3.select("#tooltip");

  if (!row) {
    tooltip
      .style("opacity", 1)
      .html(`
        <strong>${name} (${code})</strong><br>
        No data for selected filter.<br><br>
        <em>Tip: Shift + click to add or remove countries.</em>
      `)
      .style("left", `${event.pageX + 14}px`)
      .style("top", `${event.pageY + 14}px`);

    return;
  }

  const metricValue =
    filters.metric === "ValueInGWh"
      ? `${formatNumber(row.selectedValue)} GWh`
      : `${formatNumber(row.selectedValue)}%`;

  tooltip
    .style("opacity", 1)
    .html(`
      <strong>${name} (${code})</strong><br>
      Energy selection: ${getReadableEnergySelection(filters.energySelection)}<br>
      Total value: ${formatNumber(row.valueGwh)} GWh<br>
      Selected metric: ${metricValue}<br>
      Time range: ${filters.startLabel} – ${filters.endLabel}<br><br>
      <em>Click to select. Shift + click to select multiple countries.</em>
    `)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`);
}

function hideTooltip() {
  d3.select("#tooltip").style("opacity", 0);
}

function onCountryClick(event, feature) {
  event.stopPropagation();

  const code = getGeoCountryCode(feature);
  const countryFilter = document.getElementById("countryFilter");

  if (!countryFilter) return;

  const hasOption = [...countryFilter.options].some(option => option.value === code);

  if (!hasOption) return;

  updateCountrySelection(code, event.shiftKey);
  updateDashboard();
}

/* -------------------------------------------------------
   POWER FLOW VIEW
------------------------------------------------------- */

function updatePowerFlowView(filters) {
  const flowSubtitle = document.getElementById("flowSubtitle");
  const totalImports = document.getElementById("totalImports");
  const totalExports = document.getElementById("totalExports");
  const netBalance = document.getElementById("netBalance");

  if (!flowSubtitle || !totalImports || !totalExports || !netBalance) {
    return;
  }

  updateFlowNetworkMap(filters);

  const result = aggregateFlowsForSelection(filters);

  if (!hasCountrySelection(filters)) {
    flowSubtitle.textContent =
      `${filters.startLabel} to ${filters.endLabel}. Showing total European cross-border exchange.`;
  } else {
    flowSubtitle.textContent =
      `${getCountrySelectionLabel(filters)}, ${filters.startLabel} to ${filters.endLabel}.`;
  }

  totalImports.textContent = `${formatNumber(result.totalImports)} GWh`;
  totalExports.textContent = `${formatNumber(result.totalExports)} GWh`;
  netBalance.textContent = `${formatSignedNumber(result.totalExports - result.totalImports)} GWh`;

  renderFlowList("topImportList", result.topImports, "No import data available.");
  renderFlowList("topExportList", result.topExports, "No export data available.");
}

function aggregateFlowsForSelection(filters) {
  if (!hasCountrySelection(filters)) {
    return aggregateGlobalFlowSummary(filters);
  }

  return aggregateFlowsForCountryGroup(filters);
}

function aggregateGlobalFlowSummary(filters) {
  const countryStats = new Map();
  let totalExchange = 0;

  flowData.forEach(row => {
    const timeMatch =
      row.dateIndex >= filters.startIndex &&
      row.dateIndex <= filters.endIndex;

    if (!timeMatch) return;

    const value = row.ValueInGWh;

    if (!Number.isFinite(value) || value <= 0) return;
    if (!row.FromCountry || !row.ToCountry) return;
    if (row.FromCountry === row.ToCountry) return;

    totalExchange += value;

    ensureCountryFlowStats(countryStats, row.FromCountry);
    ensureCountryFlowStats(countryStats, row.ToCountry);

    countryStats.get(row.FromCountry).exports += value;
    countryStats.get(row.ToCountry).imports += value;
  });

  const stats = [...countryStats.values()];

  return {
    totalImports: totalExchange,
    totalExports: totalExchange,
    topImports: stats
      .map(item => ({ country: item.country, value: item.imports }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3),
    topExports: stats
      .map(item => ({ country: item.country, value: item.exports }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
  };
}

function aggregateFlowsForCountryGroup(filters) {
  const selectedSet = getCountrySet(filters);

  const importPartners = new Map();
  const exportPartners = new Map();

  flowData.forEach(row => {
    const timeMatch =
      row.dateIndex >= filters.startIndex &&
      row.dateIndex <= filters.endIndex;

    if (!timeMatch) return;

    const value = row.ValueInGWh;

    if (!Number.isFinite(value) || value <= 0) return;

    const fromSelected = selectedSet.has(row.FromCountry);
    const toSelected = selectedSet.has(row.ToCountry);

    // Internal flows inside a multi-country selection are ignored for external balance.
    if (fromSelected && toSelected) return;

    if (toSelected && !fromSelected) {
      addToMap(importPartners, row.FromCountry, value);
    }

    if (fromSelected && !toSelected) {
      addToMap(exportPartners, row.ToCountry, value);
    }
  });

  const imports = mapToSortedPartnerArray(importPartners);
  const exports = mapToSortedPartnerArray(exportPartners);

  return {
    totalImports: imports.reduce((sum, item) => sum + item.value, 0),
    totalExports: exports.reduce((sum, item) => sum + item.value, 0),
    topImports: imports.slice(0, 3),
    topExports: exports.slice(0, 3)
  };
}

function ensureCountryFlowStats(map, country) {
  if (!map.has(country)) {
    map.set(country, {
      country,
      imports: 0,
      exports: 0
    });
  }
}

function addToMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function mapToSortedPartnerArray(map) {
  return [...map.entries()]
    .map(([country, value]) => ({
      country,
      value
    }))
    .sort((a, b) => b.value - a.value);
}

function renderFlowList(listId, items, emptyMessage) {
  const list = document.getElementById(listId);

  if (!list) return;

  list.innerHTML = "";

  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "flow-empty";
    emptyItem.textContent = emptyMessage;
    list.appendChild(emptyItem);
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${getDisplayCountry(item.country)}</strong><br>
      <span class="partner-value">${formatNumber(item.value)} GWh</span>
    `;
    list.appendChild(li);
  });
}

/* -------------------------------------------------------
   FORCE-DIRECTED FLOW NETWORK
------------------------------------------------------- */

function drawFlowNetworkMap() {
  const container = document.getElementById("flowNetworkMap");

  if (!container) {
    console.warn("Flow network container not found.");
    return;
  }

  container.innerHTML = "";

  flowSvg = d3.select("#flowNetworkMap")
    .append("svg")
    .attr("viewBox", `0 0 ${flowMapWidth} ${flowMapHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  flowSvg.append("rect")
    .attr("class", "network-background-click")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", flowMapWidth)
    .attr("height", flowMapHeight)
    .on("click", clearCountrySelectionFromNetwork);

  flowSvg.append("g").attr("class", "network-links-layer");
  flowSvg.append("g").attr("class", "network-nodes-layer");
  flowSvg.append("g").attr("class", "network-labels-layer");
  flowSvg.append("g").attr("class", "network-legend");

  drawNetworkLegend();
}

function drawNetworkLegend() {
  const legend = flowSvg.select(".network-legend");

  legend.selectAll("*").remove();

  const x = 18;
  const y = 22;

  legend.append("text")
    .attr("class", "network-legend-title")
    .attr("x", x)
    .attr("y", y)
    .text("Network guide");

  const roleY = y + 24;

  legend.append("circle")
    .attr("cx", x + 7)
    .attr("cy", roleY)
    .attr("r", 5.5)
    .attr("fill", "#ffffff")
    .attr("stroke", "#3B82F6")
    .attr("stroke-width", 2.4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 4)
    .text("Net importer");

  legend.append("circle")
    .attr("cx", x + 7)
    .attr("cy", roleY + 20)
    .attr("r", 5.5)
    .attr("fill", "#ffffff")
    .attr("stroke", "#D96C50")
    .attr("stroke-width", 2.4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 24)
    .text("Net exporter");

  legend.append("circle")
    .attr("cx", x + 7)
    .attr("cy", roleY + 40)
    .attr("r", 5.5)
    .attr("fill", "#ffffff")
    .attr("stroke", "#1F3A5F")
    .attr("stroke-width", 2.4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 44)
    .text("Balanced role");

  legend.append("line")
    .attr("x1", x)
    .attr("x2", x + 18)
    .attr("y1", roleY + 64)
    .attr("y2", roleY + 64)
    .attr("stroke", "#3B82F6")
    .attr("stroke-width", 4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 68)
    .text("Focused imports");

  legend.append("line")
    .attr("x1", x)
    .attr("x2", x + 18)
    .attr("y1", roleY + 84)
    .attr("y2", roleY + 84)
    .attr("stroke", "#D96C50")
    .attr("stroke-width", 4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 88)
    .text("Focused exports");

  legend.append("line")
    .attr("x1", x)
    .attr("x2", x + 18)
    .attr("y1", roleY + 104)
    .attr("y2", roleY + 104)
    .attr("stroke", "#1F3A5F")
    .attr("stroke-width", 4);

  legend.append("text")
    .attr("x", x + 22)
    .attr("y", roleY + 108)
    .text("Balanced partners");

  legend.append("text")
    .attr("x", x)
    .attr("y", roleY + 132)
    .text("Hover = inspect. Click = lock. Shift + click = add.");
}


function updateFlowNetworkMap(filters) {
  if (!flowSvg) return;

  const subtitle = document.getElementById("flowNetworkSubtitle");

  const linksLayer = flowSvg.select(".network-links-layer");
  const nodesLayer = flowSvg.select(".network-nodes-layer");
  const labelsLayer = flowSvg.select(".network-labels-layer");

  linksLayer.selectAll("*").remove();
  nodesLayer.selectAll("*").remove();
  labelsLayer.selectAll("*").remove();

  const networkData = buildFlowNetworkData(filters);
  lastNetworkData = networkData;

  const nodes = networkData.nodes;
  const links = networkData.links;

  if (!nodes.length || !links.length) {
    if (subtitle) {
      subtitle.textContent = "No flow connections available for the selected time range.";
    }
    return;
  }

  if (subtitle) {
    subtitle.textContent =
      `${filters.startLabel} to ${filters.endLabel}. Hover or click a node to simplify the network into imports and exports.`;
  }

  const maxLinkValue = d3.max(links, d => d.value) || 1;
  const maxNodeValue = d3.max(nodes, d => d.totalFlow) || 1;

  const linkWidthScale = d3.scaleSqrt()
    .domain([0, maxLinkValue])
    .range([0.55, 6.2]);

  const linkOpacityScale = d3.scaleSqrt()
    .domain([0, maxLinkValue])
    .range([0.07, 0.48]);

  const nodeRadiusScale = d3.scaleSqrt()
    .domain([0, maxNodeValue])
    .range([6.5, 25]);

  nodes.forEach((node, index) => {
    node.baseRadius = nodeRadiusScale(node.totalFlow);
    node.isImportant = index < 32;
    node.balance = node.exports - node.imports;
    node.balanceRatio =
      node.totalFlow > 0
        ? node.balance / node.totalFlow
        : 0;
  });

  const backboneCount = Math.max(22, Math.round(links.length * 0.22));
  const backboneIds = new Set(
    links
      .slice(0, backboneCount)
      .map(link => link.id)
  );

  links.forEach(link => {
    link.isBackbone = backboneIds.has(link.id);
  });

  prepareNetworkLayout(nodes, links);

  linksLayer.selectAll("path")
    .data(links, d => d.id)
    .join("path")
    .attr("class", d => {
      return d.isBackbone
        ? "network-link backbone"
        : "network-link";
    })
    .attr("d", createNetworkLinkPath)
    .attr("stroke-width", d => linkWidthScale(d.value))
    .attr("data-base-width", d => linkWidthScale(d.value))
    .attr("data-base-opacity", d => linkOpacityScale(d.value))
    .style("opacity", d => linkOpacityScale(d.value))
    .on("mousemove", function(event, d) {
      showNetworkLinkTooltip(event, d);
    })
    .on("mouseleave", function() {
      hideTooltip();
      restoreSelectedNetworkFocus();
    });

  nodesLayer.selectAll("circle")
    .data(nodes, d => d.id)
    .join("circle")
    .attr("class", d => {
      return `network-node ${getNodeBalanceClass(d)}`;
    })
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", d => d.baseRadius)
    .on("mouseenter", function(event, d) {
      focusNetworkCountries([d.id]);
      showNetworkNodeTooltip(event, d.id);
    })
    .on("mousemove", function(event, d) {
      showNetworkNodeTooltip(event, d.id);
    })
    .on("mouseleave", function() {
      hideTooltip();
      restoreSelectedNetworkFocus();
    })
    .on("click", function(event, d) {
      event.stopPropagation();
      setCountryFilterFromNetworkNode(d.id, event.shiftKey);
    });

  labelsLayer.selectAll("text")
    .data(nodes, d => d.id)
    .join("text")
    .attr("class", d => {
      return d.isImportant
        ? "network-label important"
        : "network-label";
    })
    .attr("x", d => d.x)
    .attr("y", d => d.y + 4)
    .text(d => d.id);

  restoreSelectedNetworkFocus();
}


function buildFlowNetworkData(filters) {
  const nodeMap = new Map();
  const pairMap = new Map();

  flowData.forEach(row => {
    const timeMatch =
      row.dateIndex >= filters.startIndex &&
      row.dateIndex <= filters.endIndex;

    if (!timeMatch) return;

    const value = row.ValueInGWh;

    if (!Number.isFinite(value) || value <= 0) return;
    if (!row.FromCountry || !row.ToCountry) return;
    if (row.FromCountry === row.ToCountry) return;

    const source = row.FromCountry;
    const target = row.ToCountry;

    if (!nodeMap.has(source)) {
      nodeMap.set(source, createNetworkNode(source));
    }

    if (!nodeMap.has(target)) {
      nodeMap.set(target, createNetworkNode(target));
    }

    const sourceNode = nodeMap.get(source);
    const targetNode = nodeMap.get(target);

    sourceNode.exports += value;
    sourceNode.totalFlow += value;

    targetNode.imports += value;
    targetNode.totalFlow += value;

    const countries = [source, target].sort();
    const countryA = countries[0];
    const countryB = countries[1];
    const pairKey = `${countryA}|${countryB}`;

    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        id: pairKey,
        source: countryA,
        target: countryB,
        sourceCode: countryA,
        targetCode: countryB,
        countryA,
        countryB,
        valueAB: 0,
        valueBA: 0,
        value: 0,
        isBackbone: false
      });
    }

    const pair = pairMap.get(pairKey);

    if (source === countryA && target === countryB) {
      pair.valueAB += value;
    } else {
      pair.valueBA += value;
    }

    pair.value += value;
  });

  const nodes = [...nodeMap.values()].sort((a, b) => {
    return b.totalFlow - a.totalFlow;
  });

  const links = [...pairMap.values()].sort((a, b) => {
    return b.value - a.value;
  });

  return {
    nodes,
    links
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
    isImportant: false
  };
}

function getNodeBalanceClass(node) {
  if (node.balanceRatio > 0.08) {
    return "net-exporter";
  }

  if (node.balanceRatio < -0.08) {
    return "net-importer";
  }

  return "net-balanced";
}

function prepareNetworkLayout(nodes, links) {
  const centerX = flowMapWidth / 2;
  const centerY = flowMapHeight / 2;

  if (!networkAnchorProjection || !networkAnchorPath) {
    networkAnchorProjection = d3.geoMercator()
      .fitExtent(
        [
          [95, 62],
          [flowMapWidth - 70, flowMapHeight - 54]
        ],
        geoData
      );

    networkAnchorPath = d3.geoPath().projection(networkAnchorProjection);
  }

  const fallbackRadius = Math.min(flowMapWidth, flowMapHeight) * 0.34;

  nodes.forEach((node, index) => {
    const anchorPoint = getNetworkAnchorPoint(node.id);

    if (anchorPoint) {
      node.anchorX = anchorPoint[0];
      node.anchorY = anchorPoint[1];
    } else {
      const angle = (index / nodes.length) * Math.PI * 2;

      node.anchorX = centerX + Math.cos(angle) * fallbackRadius;
      node.anchorY = centerY + Math.sin(angle) * fallbackRadius;
    }

    node.x = node.anchorX;
    node.y = node.anchorY;
  });

  const maxLinkValue = d3.max(links, d => d.value) || 1;

  const simulation = d3.forceSimulation(nodes)
    .force(
      "link",
      d3.forceLink(links)
        .id(d => d.id)
        .distance(d => {
          const strength = Math.sqrt(d.value / maxLinkValue);
          return 160 - strength * 48;
        })
        .strength(0.032)
    )
    .force("charge", d3.forceManyBody().strength(-165))
    .force("collision", d3.forceCollide().radius(d => d.baseRadius + 15))
    .force("x", d3.forceX(d => d.anchorX).strength(0.23))
    .force("y", d3.forceY(d => d.anchorY).strength(0.23))
    .force("center", d3.forceCenter(centerX, centerY))
    .stop();

  for (let i = 0; i < 280; i++) {
    simulation.tick();
  }

  fitNetworkLayoutToViewport(nodes);
}

function fitNetworkLayoutToViewport(nodes) {
  if (!nodes.length) return;

  const padding = 34;
  const legendSafeLeft = 138;
  const targetMinX = legendSafeLeft;
  const targetMaxX = flowMapWidth - padding;
  const targetMinY = 42;
  const targetMaxY = flowMapHeight - 40;

  const minX = d3.min(nodes, d => d.x) || 0;
  const maxX = d3.max(nodes, d => d.x) || flowMapWidth;
  const minY = d3.min(nodes, d => d.y) || 0;
  const maxY = d3.max(nodes, d => d.y) || flowMapHeight;

  const currentWidth = Math.max(1, maxX - minX);
  const currentHeight = Math.max(1, maxY - minY);

  const targetWidth = targetMaxX - targetMinX;
  const targetHeight = targetMaxY - targetMinY;

  const scale = Math.min(
    1.18,
    targetWidth / currentWidth,
    targetHeight / currentHeight
  );

  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;
  const targetCenterX = (targetMinX + targetMaxX) / 2;
  const targetCenterY = (targetMinY + targetMaxY) / 2 + 8;

  nodes.forEach(node => {
    node.x = targetCenterX + (node.x - currentCenterX) * scale;
    node.y = targetCenterY + (node.y - currentCenterY) * scale;

    node.x = Math.max(padding, Math.min(flowMapWidth - padding, node.x));
    node.y = Math.max(padding, Math.min(flowMapHeight - padding, node.y));
  });
}


function getNetworkAnchorPoint(countryCode) {
  if (!geoData || !geoData.features || !networkAnchorPath) {
    return null;
  }

  const cleanCode = cleanCountryCode(countryCode);

  const feature = geoData.features.find(feature => {
    return getGeoCountryCode(feature) === cleanCode;
  });

  if (!feature) {
    return null;
  }

  const point = networkAnchorPath.centroid(feature);

  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    return null;
  }

  return point;
}

function createNetworkLinkPath(link) {
  const source = link.source;
  const target = link.target;

  const x1 = source.x;
  const y1 = source.y;
  const x2 = target.x;
  const y2 = target.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  const curveStrength = Math.min(55, distance * 0.18);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const normalX = -dy / distance;
  const normalY = dx / distance;

  const controlX = midX + normalX * curveStrength;
  const controlY = midY + normalY * curveStrength;

  return `M ${x1},${y1} Q ${controlX},${controlY} ${x2},${y2}`;
}

function focusNetworkNode(countryCode) {
  focusNetworkCountries([countryCode]);
}

function focusNetworkCountries(countryCodes) {
  if (!lastNetworkData || !flowSvg) return;

  resetNetworkStyles();

  const selectedSet = new Set(countryCodes.map(code => cleanCountryCode(code)));
  const connectedCountries = new Set(selectedSet);

  lastNetworkData.links.forEach(link => {
    if (selectedSet.has(link.countryA) || selectedSet.has(link.countryB)) {
      connectedCountries.add(link.countryA);
      connectedCountries.add(link.countryB);
    }
  });

  flowSvg.selectAll(".network-link")
    .classed("dimmed", d => {
      return !selectedSet.has(d.countryA) && !selectedSet.has(d.countryB);
    })
    .classed("incoming-highlight", d => {
      const relation = getPairRelationForCountrySet(d, selectedSet);
      return relation === "incoming";
    })
    .classed("outgoing-highlight", d => {
      const relation = getPairRelationForCountrySet(d, selectedSet);
      return relation === "outgoing";
    })
    .classed("bidirectional-highlight", d => {
      const relation = getPairRelationForCountrySet(d, selectedSet);
      return relation === "balanced";
    })
    .attr("stroke-width", function(d) {
      const baseWidth = Number(d3.select(this).attr("data-base-width")) || 1;

      if (selectedSet.has(d.countryA) || selectedSet.has(d.countryB)) {
        return baseWidth + 2;
      }

      return baseWidth;
    });

  flowSvg.selectAll(".network-link")
    .filter(d => selectedSet.has(d.countryA) || selectedSet.has(d.countryB))
    .raise();

  flowSvg.selectAll(".network-node")
    .classed("dimmed", d => !connectedCountries.has(d.id))
    .classed("hovered", d => selectedSet.has(d.id))
    .classed("neighbor", d => !selectedSet.has(d.id) && connectedCountries.has(d.id))
    .attr("r", d => {
      if (selectedSet.has(d.id)) {
        return d.baseRadius + 8;
      }

      if (connectedCountries.has(d.id)) {
        return d.baseRadius + 3;
      }

      return d.baseRadius;
    });

  flowSvg.selectAll(".network-label")
    .classed("dimmed", d => !connectedCountries.has(d.id))
    .classed("highlighted", d => connectedCountries.has(d.id));
}

function getPairRelationForCountrySet(link, countrySet) {
  const aSelected = countrySet.has(link.countryA);
  const bSelected = countrySet.has(link.countryB);

  if (!aSelected && !bSelected) {
    return "none";
  }

  if (aSelected && bSelected) {
    return "balanced";
  }

  let importsToSelection = 0;
  let exportsFromSelection = 0;

  if (aSelected) {
    exportsFromSelection += link.valueAB;
    importsToSelection += link.valueBA;
  }

  if (bSelected) {
    exportsFromSelection += link.valueBA;
    importsToSelection += link.valueAB;
  }

  const difference = exportsFromSelection - importsToSelection;
  const total = exportsFromSelection + importsToSelection;

  if (total <= 0) {
    return "none";
  }

  const ratio = difference / total;

  if (ratio > 0.15) {
    return "outgoing";
  }

  if (ratio < -0.15) {
    return "incoming";
  }

  return "balanced";
}

function restoreSelectedNetworkFocus() {
  if (selectedCountries.size > 0) {
    focusNetworkCountries([...selectedCountries]);
  } else {
    clearNetworkFocus();
  }
}

function clearNetworkFocus() {
  resetNetworkStyles();
}

function resetNetworkStyles() {
  if (!flowSvg) return;

  flowSvg.selectAll(".network-link")
    .classed("dimmed", false)
    .classed("incoming-highlight", false)
    .classed("outgoing-highlight", false)
    .classed("bidirectional-highlight", false)
    .attr("stroke-width", function() {
      return Number(d3.select(this).attr("data-base-width")) || 1;
    })
    .style("opacity", function() {
      return Number(d3.select(this).attr("data-base-opacity")) || 0.08;
    });

  flowSvg.selectAll(".network-node")
    .classed("dimmed", false)
    .classed("hovered", false)
    .classed("neighbor", false)
    .attr("r", d => d.baseRadius);

  flowSvg.selectAll(".network-label")
    .classed("dimmed", false)
    .classed("highlighted", false);
}

function showNetworkNodeTooltip(event, countryCode) {
  if (!lastNetworkData) return;

  const node = lastNetworkData.nodes.find(item => item.id === countryCode);

  if (!node) return;

  const incoming = getTopNetworkLinks(countryCode, "incoming", 3);
  const outgoing = getTopNetworkLinks(countryCode, "outgoing", 3);

  const incomingHtml = incoming.length
    ? incoming.map(link => {
        return `<li><span>${getShortCountryLabel(link.sourceCode)}</span><strong>${formatNumber(link.value)} GWh</strong></li>`;
      }).join("")
    : "<li><span>No imports</span></li>";

  const outgoingHtml = outgoing.length
    ? outgoing.map(link => {
        return `<li><span>${getShortCountryLabel(link.targetCode)}</span><strong>${formatNumber(link.value)} GWh</strong></li>`;
      }).join("")
    : "<li><span>No exports</span></li>";

  const balance = node.exports - node.imports;

  const role =
    balance > 0
      ? "Net exporter"
      : balance < 0
        ? "Net importer"
        : "Balanced";

  d3.select("#tooltip")
    .style("opacity", 1)
    .html(`
      <strong>${getDisplayCountry(countryCode)}</strong>
      <div class="tooltip-muted">${role}</div>

      <div class="tooltip-stat-grid">
        <div><span>Imports</span><strong>${formatNumber(node.imports)} GWh</strong></div>
        <div><span>Exports</span><strong>${formatNumber(node.exports)} GWh</strong></div>
        <div><span>Balance</span><strong>${formatSignedNumber(balance)} GWh</strong></div>
      </div>

      <div class="tooltip-two-columns">
        <div>
          <strong>Top imports</strong>
          <ul>${incomingHtml}</ul>
        </div>
        <div>
          <strong>Top exports</strong>
          <ul>${outgoingHtml}</ul>
        </div>
      </div>

      <div class="tooltip-muted">Click to lock. Shift + click to add. Empty click resets.</div>
    `)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`);
}


function showNetworkLinkTooltip(event, link) {
  d3.select("#tooltip")
    .style("opacity", 1)
    .html(`
      <strong>Electricity exchange</strong>
      <div class="tooltip-stat-grid two">
        <div><span>${getShortCountryLabel(link.countryA)} → ${getShortCountryLabel(link.countryB)}</span><strong>${formatNumber(link.valueAB)} GWh</strong></div>
        <div><span>${getShortCountryLabel(link.countryB)} → ${getShortCountryLabel(link.countryA)}</span><strong>${formatNumber(link.valueBA)} GWh</strong></div>
      </div>
      <div class="tooltip-muted">Total exchange: ${formatNumber(link.value)} GWh</div>
    `)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`);
}


function getTopNetworkLinks(countryCode, direction, limit) {
  if (!lastNetworkData) return [];

  const cleanCode = cleanCountryCode(countryCode);

  return lastNetworkData.links
    .map(link => {
      if (link.countryA !== cleanCode && link.countryB !== cleanCode) {
        return null;
      }

      let partner = null;
      let incomingValue = 0;
      let outgoingValue = 0;

      if (cleanCode === link.countryA) {
        partner = link.countryB;
        outgoingValue = link.valueAB;
        incomingValue = link.valueBA;
      }

      if (cleanCode === link.countryB) {
        partner = link.countryA;
        outgoingValue = link.valueBA;
        incomingValue = link.valueAB;
      }

      return {
        partner,
        incomingValue,
        outgoingValue,
        link
      };
    })
    .filter(item => item !== null)
    .map(item => {
      if (direction === "incoming") {
        return {
          sourceCode: item.partner,
          targetCode: cleanCode,
          value: item.incomingValue
        };
      }

      return {
        sourceCode: cleanCode,
        targetCode: item.partner,
        value: item.outgoingValue
      };
    })
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function setCountryFilterFromNetworkNode(countryCode, additive) {
  const countryFilter = document.getElementById("countryFilter");

  if (!countryFilter) return;

  const cleanCode = cleanCountryCode(countryCode);

  const hasOption = [...countryFilter.options].some(option => {
    return option.value === cleanCode;
  });

  if (!hasOption) return;

  updateCountrySelection(cleanCode, additive);
  updateDashboard();
}

function clearCountrySelectionFromMap() {
  selectedCountries.clear();
  syncCountryFilterWithSelectedCountries();
  hideTooltip();
  updateDashboard();
}

function clearCountrySelectionFromNetwork() {
  selectedCountries.clear();
  syncCountryFilterWithSelectedCountries();
  updateDashboard();
}

/* -------------------------------------------------------
   DASHBOARD UPDATE
------------------------------------------------------- */

function updateDashboard() {
  const filters = getFilters();

  updateKpis(filters);
  updateMap(filters);
  updateTitles(filters);
  updatePowerFlowView(filters);
  updateSidebarInfoPanel(filters);
}

function updateKpis(filters) {
  const aggregatedByCountry = aggregateGenerationByCountry(generationData, filters);
  const selectedSet = getCountrySet(filters);

  const visibleEntries = [...aggregatedByCountry.values()].filter(entry => {
    return selectedSet.size === 0 || selectedSet.has(entry.country);
  });

  const totalGWh = visibleEntries.reduce((sum, entry) => {
    return sum + entry.valueGwh;
  }, 0);

  const countriesWithDataCount = visibleEntries.filter(entry => {
    return entry.valueGwh > 0;
  }).length;

  const shareValue = average(visibleEntries.map(entry => entry.selectedValue));

  const selectedTotal = document.getElementById("selectedTotal");
  const countriesWithData = document.getElementById("countriesWithData");
  const selectedSource = document.getElementById("selectedSource");
  const selectedMetricElement = document.getElementById("selectedMetric");

  if (selectedTotal) {
    selectedTotal.textContent =
      filters.metric === "ValueInGWh"
        ? `${formatNumber(totalGWh)} GWh`
        : `${formatNumber(shareValue)}% avg`;
  }

  if (countriesWithData) {
    countriesWithData.textContent = countriesWithDataCount;
  }

  if (selectedSource) {
    selectedSource.textContent = getReadableEnergySelection(filters.energySelection);
  }

  if (selectedMetricElement) {
    selectedMetricElement.textContent =
      filters.metric === "ValueInGWh" ? "GWh" : "%";
  }
}

function updateTitles(filters) {
  const readableEnergy = getReadableEnergySelection(filters.energySelection);
  const countryContext = getCountrySelectionLabel(filters);

  const mapTitle = document.getElementById("mapTitle");
  const mapSubtitle = document.getElementById("mapSubtitle");

  if (mapTitle) {
    mapTitle.textContent = `European Choropleth Map - ${readableEnergy}`;
  }

  if (mapSubtitle) {
    mapSubtitle.textContent =
      `${filters.startLabel} to ${filters.endLabel}, shown as ${
        filters.metric === "ValueInGWh"
          ? "absolute generation in GWh"
          : "average relative share in %"
      }. Country filter: ${countryContext}.`;
  }
}

function updateSidebarInfoPanel(filters) {
  const infoPanel = document.querySelector(".sidebar .panel:last-child");

  if (!infoPanel) return;

  const containsInputs = infoPanel.querySelector("select, input, button, .timeline-filter, #resetFilters");

  if (containsInputs) return;

  const countryLabel = getCountrySelectionLabel(filters);
  const energyLabel = getReadableEnergySelection(filters.energySelection);
  const metricLabel = filters.metric === "ValueInGWh"
    ? "GWh"
    : "% share";

  infoPanel.innerHTML = `
    <div class="filter-info-current">
      <span>${filters.startLabel} – ${filters.endLabel}</span>
      <strong>${countryLabel}</strong>
      <small>${energyLabel}, ${metricLabel}</small>
    </div>

    <div class="filter-tip-card">
      <span class="filter-tip-kicker">Interaction tip</span>
      <p id="rotatingFilterTip"></p>
      <div id="filterTipDots" class="filter-tip-dots"></div>
    </div>
  `;

  updateSidebarTipText();
  startSidebarTipRotation();
}

function getSidebarTips() {
  return [
    "Hover a country node to fade unrelated links and inspect only its direct exchange partners.",
    "Click a country to lock the focus. Click the empty background to return to all countries.",
    "Use Shift + Click on the map or network nodes to compare multiple countries as one group.",
    "In the flow network, blue highlights mean imports or orange highlights mean exports from a country.",
    "Node outlines show the role of a country: blue (net importer), orange (net exporter) or balanced.",
    "Use GWh for absolute generation values and % for average monthly shares in the generation map.",
    "With multiple selected countries, internal flows inside selection are ignored for import/export balance."
  ];
}

function updateSidebarTipText() {
  const tipElement = document.getElementById("rotatingFilterTip");
  const dotsElement = document.getElementById("filterTipDots");

  if (!tipElement || !dotsElement) return;

  const tips = getSidebarTips();
  const safeIndex = sidebarTipIndex % tips.length;

  tipElement.textContent = tips[safeIndex];

  dotsElement.innerHTML = "";

  tips.forEach((tip, index) => {
    const dot = document.createElement("span");
    dot.className = index === safeIndex ? "active" : "";
    dotsElement.appendChild(dot);
  });
}

function startSidebarTipRotation() {
  if (sidebarTipTimer) return;

  sidebarTipTimer = window.setInterval(() => {
    sidebarTipIndex = (sidebarTipIndex + 1) % getSidebarTips().length;
    updateSidebarTipText();
  }, 6500);
}


/* -------------------------------------------------------
   GEO HELPERS
------------------------------------------------------- */

function buildCountryNameLookup() {
  countryNameLookup = new Map();

  if (!geoData || !geoData.features) return;

  geoData.features.forEach(feature => {
    const code = getGeoCountryCode(feature);
    const name = getGeoCountryName(feature);

    if (code && name) {
      countryNameLookup.set(code, name);
    }
  });
}

function getGeoCountryCode(feature) {
  return cleanCountryCode(
    feature.properties.ISO2 ||
    feature.properties.ISO_A2 ||
    feature.properties.CNTR_ID ||
    feature.properties.iso_a2 ||
    feature.id
  );
}

function getGeoCountryName(feature) {
  return (
    feature.properties.NAME ||
    feature.properties.NAME_ENGL ||
    feature.properties.ADMIN ||
    feature.properties.name ||
    "Unknown"
  );
}

function getDisplayCountry(code) {
  const cleanCode = cleanCountryCode(code);
  const name = countryNameLookup.get(cleanCode);

  if (!name || name === cleanCode) {
    return cleanCode;
  }

  return `${name} (${cleanCode})`;
}


function getShortCountryLabel(code) {
  return cleanCountryCode(code);
}

/* -------------------------------------------------------
   GENERAL HELPERS
------------------------------------------------------- */

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }

  return null;
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanCountryCode(value) {
  const text = cleanText(value).toUpperCase();

  if (!text) return "";

  return countryCodeAliases[text] || text;
}

function toNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number;
}

function uniqueSorted(values) {
  return [...new Set(values)]
    .filter(value => value !== null && value !== undefined && value !== "")
    .sort((a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a - b;
      }

      return String(a).localeCompare(String(b));
    });
}

function fillSelect(id, values, labelFunction = value => value) {
  const select = document.getElementById(id);

  if (!select) return;

  select.innerHTML = "";

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFunction(value);
    select.appendChild(option);
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

function formatSignedNumber(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(value));

  if (valid.length === 0) {
    return 0;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function showError(message) {
  const selectedTotal = document.getElementById("selectedTotal");
  const countriesWithData = document.getElementById("countriesWithData");
  const selectedSource = document.getElementById("selectedSource");
  const selectedMetricElement = document.getElementById("selectedMetric");
  const totalImports = document.getElementById("totalImports");
  const totalExports = document.getElementById("totalExports");
  const netBalance = document.getElementById("netBalance");
  const map = document.getElementById("map");

  if (selectedTotal) selectedTotal.textContent = "Error";
  if (countriesWithData) countriesWithData.textContent = "-";
  if (selectedSource) selectedSource.textContent = "-";
  if (selectedMetricElement) selectedMetricElement.textContent = "-";
  if (totalImports) totalImports.textContent = "-";
  if (totalExports) totalExports.textContent = "-";
  if (netBalance) netBalance.textContent = "-";

  if (map) {
    map.innerHTML = `
      <div style="padding: 24px; color: #D96C50;">
        <strong>Loading error:</strong><br>
        ${message}<br><br>
        Check if you are using Live Server or GitHub Pages.
      </div>
    `;
  }
}
