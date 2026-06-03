/*let svg;
let pathGenerator;
let selectedCountryCode = null;

const mapWidth = 1000;
const mapHeight = 620;

function drawMap(geoJson) {
  d3.select("#map").selectAll("*").remove();

  svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const projection = d3.geoMercator()
    .center([15, 54])
    .scale(540)
    .translate([mapWidth / 2, mapHeight / 2]);

  pathGenerator = d3.geoPath().projection(projection);

  svg.append("g")
    .attr("class", "countries-layer")
    .selectAll("path")
    .data(geoJson.features)
    .join("path")
    .attr("class", "country")
    .attr("d", pathGenerator)
    .attr("fill", "#d1d5db")
    .on("mousemove", handleCountryMouseMove)
    .on("mouseleave", hideTooltip)
    .on("click", handleCountryClick);

  createLegend();
}

function updateMap(data) {
  if (!svg) return;

  const filters = getCurrentFilters();

  const filteredData = data.filter(row =>
    Number(row.Year) === filters.year &&
    Number(row.Month) === filters.month &&
    row.EnergySource === filters.energySource
  );

  const valueByCountry = new Map();

  filteredData.forEach(row => {
    valueByCountry.set(row.Country, {
      country: row.Country,
      energySource: row.EnergySource,
      valueGwh: Number(row.ValueInGWh || 0),
      sharePercent: Number(row["ShareIn%"] || 0),
      selectedValue: Number(row[filters.metric] || 0)
    });
  });

  const values = [...valueByCountry.values()]
    .map(row => row.selectedValue)
    .filter(value => value > 0);

  const maxValue = d3.max(values) || 1;

  const colorScale = d3.scaleSequential()
    .domain([0, maxValue])
    .interpolator(d3.interpolateBlues);

  svg.selectAll(".country")
    .transition()
    .duration(300)
    .attr("fill", feature => {
      const countryCode = getCountryCode(feature);
      const row = valueByCountry.get(countryCode);

      if (!row || row.selectedValue <= 0) {
        return "#d1d5db";
      }

      return colorScale(row.selectedValue);
    });

  svg.selectAll(".country")
    .classed("selected", feature => {
      return getCountryCode(feature) === selectedCountryCode;
    })
    .each(function(feature) {
      const countryCode = getCountryCode(feature);
      const row = valueByCountry.get(countryCode);
      this.__dataValue = row || null;
      this.__currentFilters = filters;
    });

  updateLegend(maxValue, filters.metric);
}

function handleCountryMouseMove(event, feature) {
  const countryCode = getCountryCode(feature);
  const countryName = getCountryName(feature);
  const row = this.__dataValue;
  const filters = this.__currentFilters || getCurrentFilters();

  showTooltip(event, countryName, countryCode, row, filters);
}

function handleCountryClick(event, feature) {
  const countryCode = getCountryCode(feature);

  if (selectedCountryCode === countryCode) {
    selectedCountryCode = null;
  } else {
    selectedCountryCode = countryCode;
  }

  svg.selectAll(".country")
    .classed("selected", d => getCountryCode(d) === selectedCountryCode);
}

function getCountryCode(feature) {
  return (
    feature.properties.ISO_A2 ||
    feature.properties.iso_a2 ||
    feature.properties.ISO2 ||
    feature.properties.CNTR_ID ||
    feature.properties.id ||
    feature.id
  );
}

function getCountryName(feature) {
  return (
    feature.properties.NAME ||
    feature.properties.name ||
    feature.properties.ADMIN ||
    feature.properties.NAME_ENGL ||
    "Unknown country"
  );
}

function showTooltip(event, countryName, countryCode, row, filters) {
  const tooltip = d3.select("#tooltip");

  if (!row) {
    tooltip
      .style("opacity", 1)
      .html(`
        <strong>${countryName} (${countryCode})</strong><br>
        No data available for this selection.
      `)
      .style("left", `${event.pageX + 14}px`)
      .style("top", `${event.pageY + 14}px`);

    return;
  }

  const metricLabel = filters.metric === "ValueInGWh"
    ? `${formatNumber(row.valueGwh)} GWh`
    : `${row.sharePercent.toFixed(1)}%`;

  tooltip
    .style("opacity", 1)
    .html(`
      <strong>${countryName} (${countryCode})</strong><br>
      Energy source: ${row.energySource}<br>
      Value: ${formatNumber(row.valueGwh)} GWh<br>
      Share: ${row.sharePercent.toFixed(1)}%<br>
      Selected metric: ${metricLabel}
    `)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`);
}

function hideTooltip() {
  d3.select("#tooltip").style("opacity", 0);
}

function createLegend() {
  d3.select("#mapLegend").html(`
    <div class="legend-row">
      <span>low</span>
      <div class="legend-gradient"></div>
      <span>high</span>
    </div>
    <div id="legendValues" class="legend-row" style="margin-top: 6px;">
      <span>0</span>
      <span>selected metric</span>
    </div>
  `);
}

function updateLegend(maxValue, metric) {
  const unit = metric === "ValueInGWh" ? "GWh" : "%";

  d3.select("#legendValues").html(`
    <span>0 ${unit}</span>
    <span>${formatNumber(maxValue)} ${unit}</span>
  `);
}*/