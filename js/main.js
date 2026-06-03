const DATA_URL = "data/entsoe_domestic_generation_2023_2025.json";
const GEO_URL = "data/europe.geojson";

let generationData = [];
let geoData = null;
let svg = null;
let path = null;
let selectedMetric = "ShareIn%";
let timePeriods = [];

const mapWidth = 900;
const mapHeight = 610;

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
  "Hydro Water Reservoir",
  "Marine",
  "Other renewable",
  "Solar",
  "Waste",
  "Wind Offshore",
  "Wind Onshore"
];

const fossilSources = [
  "Fossil Brown coal/Lignite",
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

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [dataResponse, geoResponse] = await Promise.all([
      fetch(DATA_URL),
      fetch(GEO_URL)
    ]);

    if (!dataResponse.ok) {
      throw new Error(`Could not load data file: ${DATA_URL}`);
    }

    if (!geoResponse.ok) {
      throw new Error(`Could not load geo file: ${GEO_URL}`);
    }

    const rawData = await dataResponse.json();
    geoData = await geoResponse.json();

    generationData = normalizeData(rawData);

    console.log("Generation rows:", generationData.length);
    console.log("GeoJSON features:", geoData.features.length);
    console.log("Example data row:", generationData[0]);
    console.log("Example geo properties:", geoData.features[0].properties);

    setupFilters();
    drawMap();
    updateDashboard();
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

/* -------------------------------------------------------
   DATA NORMALIZATION
------------------------------------------------------- */

function normalizeData(rawData) {
  let rows = rawData;

  if (!Array.isArray(rawData)) {
    const firstKey = Object.keys(rawData)[0];
    rows = rawData[firstKey];
  }

  return rows.map(row => {
    const month = Number(row.Month);
    const year = Number(row.Year);

    return {
      Month: month,
      Year: year,
      dateIndex: year * 12 + month,
      Country: String(row.Country || "").trim(),
      EnergySourceID: String(row.EnergySourceID || "").trim(),
      EnergySource: String(row.EnergySource || "").trim(),
      ValueInGWh: Number(row.ValueInGWh || 0),
      "ShareIn%": Number(row["ShareIn%"] || 0)
    };
  });
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
  }
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

  timePeriods.forEach((period, index) => {
    const showTick =
      period.month === 1 ||
      period.month === 6 ||
      period.month === 12 ||
      timePeriods.length <= 12;

    if (!showTick) return;

    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.style.left = `${(index / max) * 100}%`;

    if (period.month === 1) {
      tick.textContent = period.year;
    } else if (timePeriods.length <= 12) {
      tick.textContent = period.month;
    } else {
      tick.textContent = "";
    }

    tickContainer.appendChild(tick);
  });
}

function setupCountryFilter() {
  const countries = uniqueSorted(generationData.map(d => d.Country));

  fillSelect("countryFilter", ["all", ...countries], value => {
    return value === "all" ? "All Countries" : value;
  });

  const countryFilter = document.getElementById("countryFilter");

  if (countryFilter) {
    countryFilter.value = "all";
    countryFilter.addEventListener("change", updateDashboard);
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

function getFilters() {
  const startSlider = document.getElementById("startTimeRange");
  const endSlider = document.getElementById("endTimeRange");

  const startSliderIndex = startSlider ? Number(startSlider.value) : 0;
  const endSliderIndex = endSlider ? Number(endSlider.value) : timePeriods.length - 1;

  const startPeriod = timePeriods[startSliderIndex];
  const endPeriod = timePeriods[endSliderIndex];

  return {
    startIndex: startPeriod?.index,
    endIndex: endPeriod?.index,
    startLabel: startPeriod?.label || "-",
    endLabel: endPeriod?.label || "-",
    country: document.getElementById("countryFilter")?.value || "all",
    energySelection: document.getElementById("energySourceFilter")?.value || "group:renewable",
    metric: selectedMetric
  };
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
   MAP
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

  const rowsForMap = generationData.filter(row =>
    row.dateIndex >= filters.startIndex &&
    row.dateIndex <= filters.endIndex &&
    matchesEnergySelection(row, filters.energySelection)
  );

  const aggregatedByCountry = aggregateByCountry(rowsForMap, filters.metric);

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

      if (filters.country !== "all" && filters.country !== code) {
        return "#e5e7eb";
      }

      return colorScale(row.selectedValue);
    });

  svg.selectAll(".country")
    .classed("selected", feature => {
      const code = getGeoCountryCode(feature);
      return filters.country !== "all" && filters.country === code;
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

function aggregateByCountry(rows, metric) {
  const countryMonthMap = new Map();

  rows.forEach(row => {
    const key = `${row.Country}-${row.Year}-${row.Month}`;

    if (!countryMonthMap.has(key)) {
      countryMonthMap.set(key, {
        country: row.Country,
        year: row.Year,
        month: row.Month,
        valueGwh: 0,
        sharePercent: 0
      });
    }

    const entry = countryMonthMap.get(key);

    entry.valueGwh += row.ValueInGWh;
    entry.sharePercent += row["ShareIn%"];
  });

  const countryMap = new Map();

  countryMonthMap.forEach(monthEntry => {
    if (!countryMap.has(monthEntry.country)) {
      countryMap.set(monthEntry.country, {
        country: monthEntry.country,
        valueGwh: 0,
        monthlyShares: [],
        selectedValue: 0
      });
    }

    const countryEntry = countryMap.get(monthEntry.country);

    countryEntry.valueGwh += monthEntry.valueGwh;
    countryEntry.monthlyShares.push(monthEntry.sharePercent);
  });

  countryMap.forEach(countryEntry => {
    if (metric === "ValueInGWh") {
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
        No data for selected filter.
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
      Time range: ${filters.startLabel} – ${filters.endLabel}
    `)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`);
}

function hideTooltip() {
  d3.select("#tooltip").style("opacity", 0);
}

function onCountryClick(event, feature) {
  const code = getGeoCountryCode(feature);
  const countryFilter = document.getElementById("countryFilter");

  if (!countryFilter) return;

  if (countryFilter.value === code) {
    countryFilter.value = "all";
  } else {
    countryFilter.value = code;
  }

  updateDashboard();
}

function getGeoCountryCode(feature) {
  return (
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

/* -------------------------------------------------------
   DASHBOARD UPDATE
------------------------------------------------------- */

function updateDashboard() {
  const filters = getFilters();

  const filteredRows = generationData.filter(row => {
    const timeMatch =
      row.dateIndex >= filters.startIndex &&
      row.dateIndex <= filters.endIndex;

    const energyMatch = matchesEnergySelection(row, filters.energySelection);

    const countryMatch =
      filters.country === "all" || row.Country === filters.country;

    return timeMatch && energyMatch && countryMatch;
  });

  updateKpis(filteredRows, filters);
  updateMap(filters);
  updateTitles(filters);
}

function updateKpis(filteredRows, filters) {
  const totalGWh = filteredRows.reduce((sum, row) => {
    return sum + row.ValueInGWh;
  }, 0);

  const countries = new Set(
    filteredRows
      .filter(row => row.ValueInGWh > 0)
      .map(row => row.Country)
  );

  const aggregated = aggregateByCountry(filteredRows, "ShareIn%");
  const shareAverage = average(
    [...aggregated.values()].map(entry => entry.selectedValue)
  );

  const selectedTotal = document.getElementById("selectedTotal");
  const countriesWithData = document.getElementById("countriesWithData");
  const selectedSource = document.getElementById("selectedSource");
  const selectedMetricElement = document.getElementById("selectedMetric");

  if (selectedTotal) {
    selectedTotal.textContent =
      filters.metric === "ValueInGWh"
        ? `${formatNumber(totalGWh)} GWh`
        : `${formatNumber(shareAverage)}% avg`;
  }

  if (countriesWithData) {
    countriesWithData.textContent = countries.size;
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
      }.`;
  }
}

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

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

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
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
  const map = document.getElementById("map");

  if (selectedTotal) selectedTotal.textContent = "Error";
  if (countriesWithData) countriesWithData.textContent = "-";
  if (selectedSource) selectedSource.textContent = "-";
  if (selectedMetricElement) selectedMetricElement.textContent = "-";

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