// @ts-check
import { signal } from "@preact/signals";

/**
 * @typedef {import('@preact/signals').Signal<T>} Signal<T>
 * @template {any} T
 */

/**
 * @typedef {Object} WeatherData
 * @property {number} gust
 * @property {number} direction
 * @property {Date} time
 */

/**
 * @type {Signal<string>}
 */
export const NAME = signal("Loading...");

/**
 * @type {Signal<WeatherData[]>}
 */
export const OBSERVATIONS = signal([]);

/**
 * @type {Signal<WeatherData[]>}
 */
export const FORECASTS = signal([]);

/**
 * @type {Signal<string|null>}
 */
export const LATLONG = signal(null);

const url = new URL(location.href);
const fmisid = url.searchParams.get("fmisid");

const OBSERVATION_PARAMETERS = [
    "winddirection",
    "windspeedms",
    "windgust",
    "n_man",
];

const FORECAST_PAREMETERS = [
    "winddirection",
    "windspeedms",
    "windgust",
    "maximumwind",
];

export function getStartTime() {
    const date = new Date();
    date.setHours(date.getHours() - 4, 0, 0, 0);
    return date.toISOString();
}

/**
 * Makes a request to the FMI API with the given options.
 * @param {Object} options - The options for the request.
 * @param {string} options.storedQuery - The stored query ID for the request.
 * @param {Object} options.params - The parameters for the request.
 * @returns {Promise<Document>} The parsed XML document from the response.
 * @throws Will throw an error if the request fails.
 */
export async function fmiRequest(options) {
    const url = new URL(`https://opendata.fmi.fi/wfs?request=getFeature`);
    url.searchParams.set("storedquery_id", options.storedQuery);
    for (const [k, v] of Object.entries(options.params)) {
        url.searchParams.set(k, v);
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        const parser = new DOMParser();
        const data = parser.parseFromString(text, "application/xml");
        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * @param {Document} doc
 * @param {string} path
 * @returns {Element|null}
 */
function xpath(doc, path) {
    const node = doc.evaluate(
        path,
        doc,
        function (prefix) {
            switch (prefix) {
                case "wml2":
                    return "http://www.opengis.net/waterml/2.0";
                case "gml":
                    return "http://www.opengis.net/gml/3.2";
                default:
                    return null;
            }
        },
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;

    if (node instanceof Element) {
        return node;
    }

    return null;
}

/**
 * @param {Element} node
 */
function pointsToTimeSeries(node) {
    return Array.from(node.querySelectorAll("point")).map((point) => {
        return {
            value: Number(point.querySelector("value")?.innerHTML ?? 0),
            time: new Date(
                point.querySelector("time")?.innerHTML ?? new Date(),
            ),
        };
    });
}

/**
 * @param {Document} doc
 * @param {string} id
 */
function parseTimeSeries(doc, id) {
    const node = xpath(doc, `//wml2:MeasurementTimeseries[@gml:id="${id}"]`);
    if (!node) {
        return [];
    }

    return pointsToTimeSeries(node).reverse();
}

async function updateWeatherData() {
    const doc = await fmiRequest({
        storedQuery: "fmi::observations::weather::timevaluepair",
        params: {
            starttime: getStartTime(),
            // endtime: moment().toISOString(),
            parameters: OBSERVATION_PARAMETERS.join(","),
            fmisid,
        },
    });

    // <gml:name codeSpace="http://xml.fmi.fi/namespace/locationcode/name">Kouvola Utti lentoasema</gml:name>
    const name = xpath(
        doc,
        "//gml:name[@codeSpace='http://xml.fmi.fi/namespace/locationcode/name']",
    )?.innerHTML;

    if (!name) {
        NAME.value = "Bad station?";
        return;
    }

    NAME.value = name;

    const coordinates = doc
        .querySelector("pos")
        ?.innerHTML.trim()
        .split(/\s+/)
        .join(",");

    LATLONG.value = coordinates ?? null;

    const gusts = parseTimeSeries(doc, "obs-obs-1-1-windgust");
    const directions = parseTimeSeries(doc, "obs-obs-1-1-winddirection");

    /** @type {WeatherData[]} */
    const combined = gusts.map((gust, i) => {
        return {
            gust: gust.value,
            direction: directions[i]?.value ?? -1,
            time: gust.time,
        };
    });

    OBSERVATIONS.value = combined;

    const forecastXml = await fmiRequest({
        storedQuery: "fmi::observations::weather::timevaluepair",
        params: {
            // storedquery_id: "fmi::forecast::hirlam::surface::point::timevaluepair",
            // storedquery_id: "ecmwf::forecast::surface::point::simple",
            storedquery_id:
                "fmi::forecast::edited::weather::scandinavia::point::timevaluepair",
            // storedquery_id: "ecmwf::forecast::surface::point::timevaluepair",
            // fmisid,
            // parameters: FORECAST_PAREMETERS.join(","),
            // parameters: "WindGust",
            parameters: "HourlyMaximumGust,WindDirection",
            // place: "Utti",
            latlon: coordinates,
        },
    });

    const gustForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-HourlyMaximumGust",
    );
    const directionForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-WindDirection",
    );

    /** @type {WeatherData[]} */
    const combinedForecasts = gustForecasts.map((gust, i) => {
        return {
            gust: gust.value,
            direction: directionForecasts[i]?.value ?? -1,
            time: gust.time,
        };
    });

    FORECASTS.value = combinedForecasts;
}

updateWeatherData();

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        updateWeatherData();
    }
});

window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
        updateWeatherData();
    }
});

setInterval(updateWeatherData, 60000);
