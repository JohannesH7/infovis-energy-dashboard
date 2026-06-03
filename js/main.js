const DATA_URL = "data/entsoe_domestic_generation_2025.json";
const GEO_URL = "data/europe.geojson";

let generationData = [];
let geoData = null;
let svg = null;
let path = null;
let selectedCountry = "all";

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

function normalizeData(rawData) {
  let rows = rawData;

  // Supports both:
  // [ {...}, {...} ]
  // and { "entsoe_domestic_generation_2025": [ ... ] }
  if (!Array.isArray(rawData)) {
    const firstKey = Object.keys(rawData)[0];
    rows = rawData[firstKey];
  }

  return rows.map(row => ({
    Month: Number(row.Month),
    Year: Number(row.Year),
    Country: String(row.Country).trim(),
    EnergySourceID: String(row.EnergySourceID || "").trim(),
    EnergySource: String(row.EnergySource || "").trim(),
    ValueInGWh: Number(row.ValueInGWh || 0),
    "ShareIn%": Number(row["ShareIn%"] || 0)
  }));
}

function setupFilters() {
  const years = uniqueSorted(generationData.map(d => d.Year));
  const months = uniqueSorted(generationData.map(d => d.Month));
  const countries = uniqueSorted(generationData.map(d => d.Country));
  const energySources = uniqueSorted(generationData.map(d => d.EnergySource));

  fillSelect("yearFilter", years);
  fillSelect("monthFilter", months, value => `${value} - ${monthNames[value] || value}`);
  fillSelect("energySourceFilter", energySources);

  fillSelect("countryFilter", ["all", ...countries], value => {
    return value === "all" ? "All Countries" : value;
  });

  document.getElementById("yearFilter").value = years.includes(2025) ? 2025 : years[0];
  document.getElementById("monthFilter").value = months[0];
  document.getElementById("countryFilter").value = "all";

  if (energySources.includes("Solar")) {
    document.getElementById("energySourceFilter").value = "Solar";
  } else if (energySources.includes("Wind Onshore")) {
    document.getElementById("energySourceFilter").value = "Wind Onshore";
  } else {
    document.getElementById("energySourceFilter").value = energySources[0];
  }

  document.getElementById("metricFilter").value = "ShareIn%";

  [
    "yearFilter",
    "monthFilter",
    "countryFilter",
    "energySourceFilter",
    "metricFilter"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", updateDashboard);
  });

  document.getElementById("resetFilters").addEventListener("click", () => {
    document.getElementById("yearFilter").value = years.includes(2025) ? 2025 : years[0];
    document.getElementById("monthFilter").value = months[0];
    document.getElementById("countryFilter").value = "all";
    document.getElementById("energySourceFilter").value =
      energySources.includes("Solar") ? "Solar" : energySources[0];
    document.getElementById("metricFilter").value = "ShareIn%";

    selectedCountry = "all";
    updateDashboard();
  });
}

function fillSelect(id, values, labelFunction = value => value) {
  const select = document.getElementById(id);
  select.innerHTML = "";

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFunction(value);
    select.appendChild(option);
  });
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

function getFilters() {
  return {
    year: Number(document.getElementById("yearFilter").value),
    month: Number(document.getElementById("monthFilter").value),
    country: document.getElementById("countryFilter").value,
    energySource: document.getElementById("energySourceFilter").value,
    metric: document.getElementById("metricFilter").value
  };
}

function drawMap() {
  const container = document.getElementById("map");
  container.innerHTML = "";

  svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const projection = d3.geoMercator();

  path = d3.geoPath().projection(projection);

  // Automatically fit Europe into the available SVG area
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

function updateDashboard() {
  const filters = getFilters();

  const filteredRows = generationData.filter(row => {
    const timeAndSourceMatch =
      row.Year === filters.year &&
      row.Month === filters.month &&
      row.EnergySource === filters.energySource;

    const countryMatch =
      filters.country === "all" || row.Country === filters.country;

    return timeAndSourceMatch && countryMatch;
  });

  updateKpis(filteredRows, filters);
  updateMap(filters);
  updateTitles(filters);
}

function updateKpis(filteredRows, filters) {
  const totalGWh = filteredRows.reduce((sum, row) => sum + row.ValueInGWh, 0);
  const countries = new Set(filteredRows.filter(row => row.ValueInGWh > 0).map(row => row.Country));

  const totalText =
    filters.metric === "ValueInGWh"
      ? `${formatNumber(totalGWh)} GWh`
      : `${formatNumber(average(filteredRows.map(row => row["ShareIn%"])))}% avg`;

  document.getElementById("selectedTotal").textContent = totalText;
  document.getElementById("countriesWithData").textContent = countries.size;
  document.getElementById("selectedSource").textContent = filters.energySource;
  document.getElementById("selectedMetric").textContent =
    filters.metric === "ValueInGWh" ? "GWh" : "%";
}

function updateTitles(filters) {
  document.getElementById("mapTitle").textContent =
    `European Choropleth Map - ${filters.energySource}`;

  document.getElementById("mapSubtitle").textContent =
    `${monthNames[filters.month]} ${filters.year}, shown as ${
      filters.metric === "ValueInGWh" ? "absolute generation in GWh" : "relative share in %"
    }.`;
}

function updateMap(filters) {
  const rowsForMap = generationData.filter(row =>
    row.Year === filters.year &&
    row.Month === filters.month &&
    row.EnergySource === filters.energySource
  );

  const valueByCountry = new Map();

  rowsForMap.forEach(row => {
    valueByCountry.set(row.Country, row);
  });

  const values = rowsForMap
    .map(row => row[filters.metric])
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
      const row = valueByCountry.get(code);

      if (!row || row[filters.metric] <= 0) {
        return "#d1d5db";
      }

      if (filters.country !== "all" && filters.country !== code) {
        return "#e5e7eb";
      }

      return colorScale(row[filters.metric]);
    });

  svg.selectAll(".country")
    .classed("selected", feature => {
      const code = getGeoCountryCode(feature);
      return filters.country !== "all" && filters.country === code;
    })
    .each(function(feature) {
      const code = getGeoCountryCode(feature);
      this.__energyRow = valueByCountry.get(code) || null;
      this.__filters = filters;
    });

  const unit = filters.metric === "ValueInGWh" ? "GWh" : "%";
  document.getElementById("legendMax").textContent =
    `Max: ${formatNumber(maxValue)} ${unit}`;
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

  tooltip
    .style("opacity", 1)
    .html(`
      <strong>${name} (${code})</strong><br>
      Energy source: ${row.EnergySource}<br>
      Value: ${formatNumber(row.ValueInGWh)} GWh<br>
      Share: ${formatNumber(row["ShareIn%"])}%<br>
      Time: ${monthNames[row.Month]} ${row.Year}
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
  document.getElementById("selectedTotal").textContent = "Error";
  document.getElementById("countriesWithData").textContent = "-";
  document.getElementById("selectedSource").textContent = "-";
  document.getElementById("selectedMetric").textContent = "-";

  document.getElementById("map").innerHTML = `
    <div style="padding: 24px; color: #D96C50;">
      <strong>Loading error:</strong><br>
      ${message}<br><br>
      Check if you are using Live Server or GitHub Pages.
    </div>
  `;
}