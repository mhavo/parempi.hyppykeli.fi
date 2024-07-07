// @ts-check
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import {
    FORECASTS,
    OBSERVATIONS,
    NAME,
    LATLONG,
    METARS,
    STATION_NAME,
    ERRORS,
    HOVERED_OBSERVATION,
    updateWeatherData,
    LOADING,
} from "./data.js";

import { Graph } from "./graph.js";
import { Compass } from "./compass.js";
import { formatClock } from "./utils.js";

NAME.subscribe((val) => {
    if (val) {
        document.title = val + " – Hyppykeli";
    }
});

/**
 * @typedef {import('./data.js').WeatherData} WeatherData
 */

/**
 * @typedef {import('@preact/signals').Signal<T>} Signal<T>
 * @template {any} T
 */

/**
 * @param {number} gust
 */
function getWarningLevel(gust) {
    let className = "ok";

    if (gust >= 8) {
        className = "warning";
    }

    if (gust >= 11) {
        className = "danger";
    }

    return className;
}

function ObservationTHead() {
    return html`
        <tr>
            <th>Kello</th>
            <th>Puuska</th>
            <th>Tuuli</th>
            <th>Suunta</th>
        </tr>
    `;
}

/**
 * @param {Object} props
 * @param {WeatherData[]} props.data
 */
function ObservationRows(props) {
    return props.data.map((point) => {
        return html`
            <tr>
                <td title=${point.time.toString()}>
                    ${formatClock(point.time)}
                </td>
                <td class=${getWarningLevel(point.gust)}>${point.gust} m/s</td>
                <td>${point.speed} m/s</td>
                <td>
                    <${WindDirection} direction=${point.direction} />
                </td>
            </tr>
        `;
    });
}

function ForecastTHead() {
    return html`<tr>
        <th>Kello</th>
        <th>Puuska</th>
        <th>Tuuli</th>
        <th>Suunta</th>
        <th>Pilvikatto</th>
    </tr>`;
}

/**
 * @param {Object} props
 * @param {WeatherData[]} props.data
 */
function ForecastRows(props) {
    return props.data.map((point) => {
        return html`<tr>
            <td title=${point.time.toString()}>${formatClock(point.time)}</td>
            <td class=${getWarningLevel(point.gust)}>${point.gust} m/s</td>
            <td>${point.speed} m/s</td>
            <td>
                <${WindDirection} direction=${point.direction} />
            </td>
            <td>${point.cloudCover?.toFixed(0) ?? "-1"}%</td>
        </tr> `;
    });
}

/**
 *
 * @param {Object} props
 * @param {number} props.direction
 */
function WindDirection(props) {
    return html`
        <span>
            <span class="direction-value">${props.direction.toFixed(0)}°</span>
            <span
                class="direction"
                style=${{ "--direction": props.direction + "deg" }}
                >↑</span
            >
        </span>
    `;
}

/**
 * @param {Object} props
 * @param {Signal<unknown[]>} props.data
 * @param {any} props.Rows
 * @param {any} props.thead
 */
function DataTable(props) {
    const [showAll, setShowAll] = useState(false);
    const data = showAll ? props.data.value : props.data.value.slice(0, 50);
    const showLoadMore = !showAll && props.data.value.length > data.length;

    return html`
        <table class="weather-table">
            <thead>
                ${props.thead}
            </thead>
            <tbody>
                <${props.Rows} data=${data} />
            </tbody>
        </table>
        ${showLoadMore
            ? html`
                  <div class="show-more">
                      <button type="button" onClick=${() => setShowAll(true)}>
                          Näytä kaikki (${props.data.value.length})
                      </button>
                  </div>
              `
            : null}
    `;
}

/**
 * Set value returned by the setter function to the state every second.
 *
 * @param {() => T} setter
 * @template {any} T
 * @returns {T}
 */
function useInterval(setter) {
    const [state, setState] = useState(/** @type {T} */ (setter()));
    useEffect(() => {
        setState(setter());
        const interval = setInterval(() => {
            setState(setter());
        }, 1000);

        return () => {
            clearInterval(interval);
        };
    }, [setter]);

    return state;
}

/**
 * @param {Object} props
 * @param {Date} [props.date]
 */
function FromNow(props) {
    const createFromNow = useCallback(() => {
        if (!props.date) {
            return "";
        }

        return new Intl.RelativeTimeFormat("fi").format(
            Math.round(-(Date.now() - props.date.getTime()) / 1000 / 60),
            "minutes",
        );
    }, [props.date]);

    const fromNow = useInterval(createFromNow);

    return html`<span class="from-now">${fromNow}</span> `;
}

function LatestGust() {
    const history = !!HOVERED_OBSERVATION.value;
    const latest = HOVERED_OBSERVATION.value || OBSERVATIONS.value[0];
    if (!latest) {
        return html`<p>Ladataan tuulitietoja...</p>`;
    }

    return html`
        <p class=${history ? "historic" : ""}>
            Puuska
            <span
                class=${"latest-value latest-gust " +
                getWarningLevel(latest.gust)}
            >
                ${" "}${latest.gust} m/s${" "}
            </span>
            Tuuli
            <span class="latest-value latest-wind"
                >${" "}${latest.speed} m/s${" "}</span
            >
            <${FromNow} date=${latest.time} />
        </p>
    `;
}

/**
 * @param {number} hectoMeters
 * @returns {number}
 */
function hectoFeetToMeters(hectoMeters) {
    return hectoMeters * 30.48;
}

// const CLOUDS = {
//     NCD: "Ei pilviä",
//     VV: "SUMUA PERKELE",
//     NSC: "Yksittäisiä",
//     FEW: "Muutamia",
//     SCT: "Hajanaisia",
//     BKN: "Rakoileva",
//     OVC: "Täysi pilvikatto",
// };

/**
 * @type {Record<string, string>}
 */
const CLOUD_TYPES = {
    1: "Muutamia", // Few
    2: "Hajanaisia", // Scattered
    3: "Rikkonainen", // Broken
    4: "Täysi pilvikatto", // Overcast
};

function LatestMetar() {
    const latest = METARS.value?.at(-1);

    if (!latest) {
        return html`<p>Ladataan METAR-sanomaa...</p>`;
    }

    let msg = "";

    if (latest?.clouds.length === 0) {
        if (latest.metar.includes("METAR")) {
            msg = "Ei pilviä alle 1500M (CAVOK)";
        } else {
            msg = "Tietoa pilvistä";
        }
    }

    return html`
        <ul>
            ${msg
                ? html`<p>${msg}</p>`
                : latest.clouds.map(
                      (cloud, i) =>
                          html`<li>
                              <a href=${cloud.href}
                                  >${CLOUD_TYPES[cloud.amount] ??
                                  cloud.amount}</a
                              >${" "}
                              ${hectoFeetToMeters(cloud.base).toFixed(0)}M
                              ${" "}
                          </li>`,
                  )}
        </ul>

        <p>
            <${FromNow} date=${latest.time} />
            <br />
            <em class="metar">${latest.metar}</em>
        </p>
    `;
}

function UpdateButton() {
    return html`
        <button
            disabled=${LOADING.value > 0}
            onClick=${() => {
                updateWeatherData();
            }}
        >
            ♻
        </button>
    `;
}

function Root() {
    const history = !!HOVERED_OBSERVATION.value;
    const latestMetar = METARS.value?.[0];
    return html`
        <div>
            <div class="content">
                ${ERRORS.value.length > 0
                    ? html`
                          <div class="errors">
                              ${ERRORS.value.map((error) => {
                                  return html` <p>${error}</p> `;
                              })}
                          </div>
                      `
                    : null}

                <h1 id="#top">
                    <a class="logo" href="/"> Hyppykeli</a> –${" "}
                    <span id="title">${NAME}</span>
                </h1>

                <p>
                    ${STATION_NAME.value
                        ? html`
                              Katso havaintoaseman${" "}
                              <a
                                  href="https://www.google.fi/maps/place/${LATLONG}"
                                  >${STATION_NAME} sijainti</a
                              >.
                          `
                        : "Ladataan..."}
                    ${latestMetar
                        ? html`
                              ${" "}Lentokentän korkeus meren pinnasta${" "}
                              ${latestMetar.elevation.toFixed(0)}M. ${" "}
                          `
                        : null}

                    <span class="disclaimer">
                        Tietojen käyttö omalla vastuulla. Ei takeita että tiedot
                        ovat oikein.
                    </span>
                </p>

                <div class="as-rows-on-big-screen">
                    <div>
                        <h2>Pilvet</h2>
                        <${LatestMetar} />
                    </div>
                    <div>
                        <div class="anchor" id="latest"></div>
                        <h2>Tuulet</h2>

                        <${Compass} />

                        <${LatestGust} />
                    </div>
                </div>

                <${Graph} />

                <div class="as-rows-on-big-screen">
                    <div>
                        <div class="anchor" id="observations"></div>
                        <h2 class="sticky">Havainnot</h2>
                        <${DataTable}
                            data=${OBSERVATIONS}
                            thead=${html`<${ObservationTHead} />`}
                            Rows=${ObservationRows}
                        />
                    </div>

                    <div>
                        <div class="anchor" id="forecasts"></div>
                        <h2 class="sticky">Ennuste</h2>
                        <${DataTable}
                            data=${FORECASTS}
                            thead=${html`<${ForecastTHead} />`}
                            Rows=${ForecastRows}
                        />
                    </div>
                </div>
            </div>

            <div class="sticky-footer">
                <a class="item" href="#top">
                    <div class="wrap">
                        <div class="icon">⬆️</div>
                    </div>
                </a>

                <a class="item" href="#observation-graph">
                    <div class="wrap">
                        <div class="icon">📈</div>
                        <div class="text">Havainnot</div>
                    </div>
                </a>

                <a class="item" href="#forecast-graph">
                    <div class="wrap">
                        <div class="icon">📈</div>
                        <div class="text">Ennuste</div>
                    </div>
                </a>

                <a class="item" href="#observations">
                    <div class="wrap">
                        <div class="icon">🧾</div>
                        <div class="text">Havainnot</div>
                    </div>
                </a>

                <a class="item" href="#forecasts">
                    <div class="wrap">
                        <div class="icon">🧾</div>
                        <div class="text">Ennuste</div>
                    </div>
                </a>

                <div class="item">
                    <div class="wrap">
                        <${UpdateButton} />
                    </div>
                </div>
            </div>
        </div>
    `;
}

const root = document.getElementById("root");
if (!root) {
    throw new Error("Root element not found");
}
render(html`<${Root} />`, root);
