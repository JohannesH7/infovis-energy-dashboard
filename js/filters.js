function setupFilters(data) {
  const years = [...new Set(data.map(row => Number(row.Year)))].sort((a, b) => a - b);
  const months = [...new Set(data.map(row => Number(row.Month)))].sort((a, b) => a - b);
  const energySources = [...new Set(data.map(row => row.EnergySource))].sort();

  fillSelect("yearFilter", years);
  fillSelect("monthFilter", months);
  fillSelect("energySourceFilter", energySources);

  if (years.length > 0) {
    document.getElementById("yearFilter").value = years[years.length - 1];
  }

  if (months.length > 0) {
    document.getElementById("monthFilter").value = months[0];
  }

  if (energySources.length > 0) {
    const preferredSource = energySources.includes("Solar")
      ? "Solar"
      : energySources[0];

    document.getElementById("energySourceFilter").value = preferredSource;
  }

  document.getElementById("metricFilter").value = "ShareIn%";

  const filterIds = [
    "yearFilter",
    "monthFilter",
    "energySourceFilter",
    "metricFilter"
  ];

  filterIds.forEach(id => {
    document.getElementById(id).addEventListener("change", updateDashboard);
  });

  document.getElementById("resetFilters").addEventListener("click", () => {
    if (years.length > 0) {
      document.getElementById("yearFilter").value = years[years.length - 1];
    }

    if (months.length > 0) {
      document.getElementById("monthFilter").value = months[0];
    }

    if (energySources.length > 0) {
      document.getElementById("energySourceFilter").value =
        energySources.includes("Solar") ? "Solar" : energySources[0];
    }

    document.getElementById("metricFilter").value = "ShareIn%";

    updateDashboard();
  });
}

function fillSelect(selectId, values) {
  const select = document.getElementById(selectId);
  select.innerHTML = "";

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function getCurrentFilters() {
  return {
    year: Number(document.getElementById("yearFilter").value),
    month: Number(document.getElementById("monthFilter").value),
    energySource: document.getElementById("energySourceFilter").value,
    metric: document.getElementById("metricFilter").value
  };
}