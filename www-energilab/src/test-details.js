import {
  Chart,
  TimeScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-date-fns';

Chart.register(
  annotationPlugin,
  TimeScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

function randomRGBA(opacity = 0.2) {
  const r = Math.floor(Math.random() * 180 + 50);
  const g = Math.floor(Math.random() * 180 + 50);
  const b = Math.floor(Math.random() * 180 + 50);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const standardColors = {
  idle: 'rgba(200,200,200,0.2)',
  warmup: 'rgba(255, 235, 59, 0.2)',
  work: 'rgba(76, 175, 80, 0.2)',
  warmdown: 'rgba(255, 152, 0, 0.2)'
};

function drawChart(graphData, stateZones) {
  const ctx = document.getElementById('graph').getContext('2d');

  const keys = ['apower', 'cpu'];
  const colors = {
    apower: 'rgba(255, 99, 132, 1)',
    cpu: 'rgba(54, 162, 235, 1)'
  };

  const grouped = {};
  keys.forEach(k => grouped[k] = []);
  graphData.forEach(d => {
    const ts = new Date(d.timestamp);
    if (keys.includes(d.key)) {
      grouped[d.key].push({ x: ts, y: d.value });
    }
  });

  const datasets = [
    {
      label: 'apower',
      data: grouped['apower'],
      borderColor: colors['apower'],
      backgroundColor: 'transparent',
      tension: 0.2,
      yAxisID: 'y'
    },
    {
      label: 'cpu',
      data: grouped['cpu'],
      borderColor: colors['cpu'],
      backgroundColor: 'transparent',
      tension: 0.2,
      yAxisID: 'y1'
    }
  ];

  const zonePlugins = stateZones.map((z) => {
    const name = z.name.toLowerCase();
    const background = standardColors[name] || randomRGBA();

    return {
      type: 'box',
      xMin: new Date(z.start_time),
      xMax: new Date(z.end_time),
      backgroundColor: background,
      borderWidth: 0,
      label: {
        display: true,
        content: z.name,
        position: 'center',
        font: { weight: 'bold' },
        color: '#000'
      }
    };
  });

  new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        annotation: {
          annotations: zonePlugins
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'yyyy-MM-dd HH:mm',
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm'
            }
          },
          title: {
            display: true,
            text: 'Tid'
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: 10,
          title: {
            display: true,
            text: 'Watt (apower)'
          },
          position: 'left'
        },
        y1: {
          beginAtZero: true,
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'CPU (%)'
          },
          position: 'right',
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

window.drawChart = drawChart;

