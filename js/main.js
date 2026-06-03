let generationData = [];
let geoData = [];

async function initApp() {
  try {
    const [generationResponse, geoResponse] = await Promise.all([
      fetch("data/entsoe_domestic_generation_2025.json"),
      fetch("data/europe.geojson")
    ]);

    if (!generationResponse.ok) {
      throw new Error("Generation JSON could not be loaded.");
    }

    if (!geoResponse.ok) {
      throw new Error("Europe GeoJSON could not be loaded.");
    }

    generationData = await generationResponse.json();
    geoData = await geoResponse.json();

    setupFilters(generationData);
    drawMap(geoData);
    updateDashboard();

    console.log("Application initialized successfully.");
  } catch (error) {
    console.error("Initialization error:", error);
    showLoadingError(error.message);
  }
}

function updateDashboard() {
  updateMap(generationData);
  updateKpis(generationData);
}

function updateKpis(data) {
  const filters = getCurrentFilters();

  const filteredData = data.filter(row =>
    Number(row.Year) === filters.year &&
    Number(row.Month) === filters.month &&
    row.EnergySource === filters.energySource
  );

  const totalGeneration = filteredData.reduce((sum, row) => {
    return sum + Number(row.ValueInGWh || 0);
  }, 0);

  const countriesWithData = new Set(filteredData.map(row => row.Country));

  document.getElementById("totalGeneration").textContent =
    `${formatNumber(totalGeneration)} GWh`;

  document.getElementById("countryCount").textContent =
    countriesWithData.size;

  document.getElementById("selectedSource").textContent =
    filters.energySource;

  document.getElementById("selectedMetric").textContent =
    filters.metric === "ValueInGWh" ? "GWh" : "%";
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 1
  });
}

function showLoadingError(message) {
  const map = document.getElementById("map");
  map.innerHTML = `
    <div style="padding: 24px; color: #d96c50;">
      <strong>Error:</strong> ${message}
    </div>
  `;
}

initApp();