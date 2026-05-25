async function loadData() {
  try {
    const response = await fetch("data/entsoe_sample.json");

    if (!response.ok) {
      throw new Error("Could not load JSON file");
    }

    const data = await response.json();
    console.log("Loaded data:", data);

    updateKpis(data);
    fillCountryFilter(data);
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

function updateKpis(data) {
  const totalGeneration = data.reduce((sum, row) => {
    return sum + Number(row.ValueInGWh || 0);
  }, 0);

  const countries = new Set(data.map(row => row.Country));
  const energySources = new Set(data.map(row => row.EnergySource));

  document.getElementById("totalGeneration").textContent =
    `${totalGeneration.toFixed(1)} GWh`;

  document.getElementById("countryCount").textContent =
    countries.size;

  document.getElementById("sourceCount").textContent =
    energySources.size;
}

function fillCountryFilter(data) {
  const countryFilter = document.getElementById("countryFilter");
  const countries = [...new Set(data.map(row => row.Country))].sort();

  countries.forEach(country => {
    const option = document.createElement("option");
    option.value = country;
    option.textContent = country;
    countryFilter.appendChild(option);
  });
}

loadData();