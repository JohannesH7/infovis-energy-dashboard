# European Energy Transition Dashboard

This project is an interactive information visualization about electricity generation and power flows in Europe.

The data is based on ENTSO-E Power Statistics and was cleaned and converted into JSON format before implementation.

## Current Prototype

The current version focuses on the first visualization component:

- Interactive European choropleth map
- Filter by year
- Filter by month
- Filter by energy source
- Switch between GWh and percentage share
- Hover tooltip with country-specific values
- KPI cards for selected data

## Technologies Used

- HTML
- CSS
- JavaScript
- D3.js
- JSON
- GeoJSON
- GitHub Pages

## Reasons for Technology Selection

The project is implemented as a static web application because it does not require a backend server. GitHub Pages can host the application directly from the repository. D3.js is used because it provides flexible tools for SVG-based maps, geographic projections, color scales and interaction.

## Alternatives Considered

- React: not used initially to avoid additional complexity and build steps.
- Chart.js: useful for standard charts, but less suitable for custom map visualizations.
- Leaflet: strong for map tiles, but the first prototype focuses on a custom SVG choropleth map.
- Tableau / Power BI: not used because the goal is to create a self-developed web visualization.
- Flourish: used as inspiration, but not as the implementation tool.

## Folder Structure

```text
/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── main.js
│   ├── filters.js
│   └── map.js
├── data/
│   ├── entsoe_domestic_generation_2025.json
│   └── europe.geojson
└── assets/
    └── screenshots/