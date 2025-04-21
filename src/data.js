// @ts-check
// docs https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=describeStoredQueries&
import { computed, effect, signal } from "@preact/signals";
import {
    debug,
    filterNullish,
    isNullish,
    hasValidWindData,
    knotsToMs,
    removeNullish,
    safeParseNumber,
    fetchJSON,
} from "./utils.js";
import { fetchHighWinds } from "./om.js";
// just exposes the parseMETAR global
import "metar";

/**
 * @typedef {import("@preact/signals").Signal} Signal
 */

/**
 * @typedef {object} QueryParams
 * @property {string} [fmisid] FMI station ID
 * @property {string} [roadsid] Digitraffic road station ID
 * @property {string} [lat] Latitude for forecast (e.g. "60.45")
 * @property {string} [lon] Longitude for forecast (e.g. "25.55")
 * @property {string} [icaocode] ICAO code for METAR (e.g. "EFUT")
 * @property {string} [forecast_day] Number of days from today (0, 1, 2...)
 * @property {string} [forecast_range] Forecast range in hours (default 12)
 * @property {string} [observation_range] Observation range in hours (default 12)
 * @property {string} [name] Custom name for the location
 * @property {string} [save] Flag to save the current location
 * @property {string} [flyk_metar] Flag to use Flyk METAR instead of FMI
 * @property {string} [__directions] Debugging: Mock directions (comma-separated numbers)
 * @property {string} [__gusts] Debugging: Mock gusts (comma-separated numbers)
 * @property {string} [__speeds] Debugging: Mock speeds (comma-separated numbers)
 * @property {string} [debug] Debugging flag
 * @property {string} [mock] Debugging flag for mock data source
 * @property {string} [allow_mock] Allow mocking on production
 * @property {string} [high_winds_details] Show high winds details
 */

/**
 * @typedef {object} TimeValuePair
 * @property {number} value
 * @property {Date} time
 */

/**
 * @typedef {object} WeatherData
 * @property {"fmi" | "roads" | "forecast" | "mock" | "metar"} source
 * @property {number} [speed] Wind speed in m/s
 * @property {number} [gust] Wind gust in m/s
 * @property {number} [direction] Wind direction in degrees (0-360)
 * @property {number} [temperature] Temperature in Celsius
 * @property {number} [dewPoint] Dew point in Celsius
 * @property {number} [lowCloudCover] Low cloud cover percentage (0-100)
 * @property {number} [middleCloudCover] Middle and low cloud cover percentage (0-100)
 * @property {number} [rain] Precipitation probability (0-100)
 * @property {Date} time
 */

/**
 * @typedef {object} CloudLayer
 * @property {string} amount // e.g. "FEW", "SCT", "BKN", "OVC"
 * @property {number} [base] Base altitude in feet
 * @property {string} [href] WMO code href
 * @property {string} [type] // e.g. "CB"
 */

/**
 * @typedef {object} MetarCloud // Local definition for clouds from parseMETAR
 * @property {string} abbreviation // e.g., "FEW", "SCT", "BKN", "OVC", "CB"
 * @property {number} [altitude] // Altitude in feet
 */

/**
 * @typedef {object} MetarData
 * @property {Date} time
 * @property {string} metar // Raw METAR string
 * @property {boolean} cb // Cumulonimbus present
 * @property {{gust?: number, speed?: number, direction: number|string, unit: string}} wind
 * @property {number | undefined} temperature // Temperature in Celsius
 * @property {number | undefined} [dewPoint] Dew point in Celsius
 * @property {CloudLayer[]} clouds
 * @property {number} [elevation] Station elevation in meters
 */

/**
 * @typedef {"fmi::forecast::edited::weather::scandinavia::point::timevaluepair" | "fmi::observations::weather::timevaluepair" | "fmi::avi::observations::iwxxm"} StoredQuery
 */

/**
 * @typedef {object} RoadStationInfoDetailed
 * @property {object} geometry
 * @property {number[]} geometry.coordinates // [lon, lat]
 * @property {object} properties
 * @property {object} properties.names
 * @property {string} properties.names.fi // Finnish name
 */

/**
 * @typedef {object} RoadSensorValue
 * @property {string} name // e.g. "MAKSIMITUULI", "KESKITUULI", "TUULENSUUNTA", "ILMA", "KASTEPISTE"
 * @property {number} value
 * @property {string} unit
 */

/**
 * @typedef {object} RoadStationObservationEntry
 * @property {string} dataUpdatedTime // ISO date string
 * @property {string} measuredTime // ISO date string
 * @property {RoadSensorValue[]} sensorValues
 */

/**
 * @typedef {RoadStationObservationEntry} RoadStationObservations // For /data endpoint (latest)
 */

/**
 * @typedef {RoadStationObservationEntry[]} RoadStationObservationsHistory_Incorrect // For /data/history endpoint (Old incorrect assumption)
 */

/**
 * @typedef {object} RoadObservationValue // As seen in orig_data.js processing
 * @property {number} id // Sensor ID
 * @property {string} measuredTime // ISO date string
 * @property {number} value
 */

/**
 * @typedef {object} RoadStationHistory // As seen in orig_data.js processing
 * @property {RoadObservationValue[]} values
 */

// Remove @typedef imports for types defined locally above
// @typedef {import("./types.d.ts").QueryParams} QueryParams
// @typedef {import("./types.d.ts").WeatherData} WeatherData
// @typedef {import("./types.d.ts").MetarData} MetarData
// @typedef {import("./types.d.ts").StoredQuery} StoredQuery
/** @typedef {import("./types.d.ts").FlykMetar} FlykMetar */
/** @typedef {import("./types.d.ts").FlykMetarFeature} FlykMetarFeature */
// @typedef {import("./types.d.ts").RoadStationInfoDetailed} RoadStationInfoDetailed
// @typedef {import("./types.d.ts").RoadSensorValue} RoadSensorValue
// @typedef {import("./types.d.ts").RoadStationObservationEntry} RoadStationObservationEntry
// @typedef {import("./types.d.ts").RoadStationObservations} RoadStationObservations
// @typedef {import("./types.d.ts").RoadStationObservationsHistory} RoadStationObservationsHistory

/** @type {import("@preact/signals").Signal<QueryParams[]>} */
export const SAVED_DZs = signal(
    (() => {
        try {
            // Use 'window' explicitly for localStorage to avoid issues in some environments
            const saved = window.localStorage.getItem("saved_dzs");
            return saved ? JSON.parse(saved) : [];
        } catch {
            console.error("Failed to parse saved_dzs from localStorage");
            return [];
        }
    })(),
);

/**
 * @param {string|null|undefined} name
 */
export function saveCurrentDz(name) {
    name = name ?? undefined;
    let qp = QUERY_PARAMS.value;
    const index = SAVED_DZs.value.findIndex(
        (/** @type {QueryParams} */ dz) => dz.name === name,
    ); // Use strict equality

    // Omit the 'save' parameter when saving
    const qpToSave = { ...qp, name };
    delete qpToSave.save;

    let newSavedDzs;
    if (index === -1) {
        newSavedDzs = [...SAVED_DZs.value, qpToSave];
    } else {
        // Array.prototype.with is a modern feature, check compatibility or polyfill if needed
        // Or use slice/splice/map for broader compatibility
        try {
            newSavedDzs = SAVED_DZs.value.with(index, qpToSave);
        } catch (e) {
            console.warn(
                "Array.prototype.with not available, falling back to map",
                e,
            );
            newSavedDzs = SAVED_DZs.value.map(
                (/** @type {QueryParams} */ item, /** @type {number} */ i) =>
                    i === index ? qpToSave : item,
            );
        }
    }

    window.localStorage.setItem("saved_dzs", JSON.stringify(newSavedDzs));
    SAVED_DZs.value = newSavedDzs; // Update signal after successful save
}

/**
 * @param {string} name
 */
export function removeSavedDz(name) {
    const filtered = SAVED_DZs.value.filter(
        (/** @type {QueryParams} */ dz) => dz.name !== name,
    );
    window.localStorage.setItem("saved_dzs", JSON.stringify(filtered));
    SAVED_DZs.value = filtered; // Update signal
}

/**
 * Current URLSearchParams (query string) in the location bar
 * @type {import("@preact/signals").Signal<QueryParams>}
 */
export const QUERY_PARAMS = signal(
    Object.fromEntries(new URLSearchParams(location.search)),
);

/**
 * @type {import("@preact/signals").Signal<string|undefined>}
 */
export const NAME = signal(QUERY_PARAMS.value.name);

/**
 * @type {import("@preact/signals").Signal<number>}
 */
export const LOADING = signal(0);

/**
 * @type {import("@preact/signals").Signal<boolean>}
 */
export const STALE_FORECASTS = signal(true);

/**
 * @type {import("@preact/signals").Signal<string | undefined>}
 */
export const STATION_NAME = signal(undefined);

/**
 * @type {import("@preact/signals").Signal<WeatherData[]>}
 */
export const OBSERVATIONS = signal([]);

export const HAS_WIND_OBSERVATIONS = computed(() => {
    let count = 0;

    for (const obs of OBSERVATIONS.value) {
        if (hasValidWindData(obs)) {
            count++;
        }

        // At least two observations with wind data needed for meaningful trend/variation
        if (count > 1) {
            return true;
        }
    }
    // Also check if LATEST_OBSERVATION (which might be METAR) has wind
    if (
        count < 2 &&
        LATEST_OBSERVATION.value &&
        hasValidWindData(LATEST_OBSERVATION.value)
    ) {
        count++;
    }

    return count > 1; // Need at least 2 wind data points total
});

/**
 * @type {import("@preact/signals").Signal<WeatherData|undefined>}
 */
export const HOVERED_OBSERVATION = signal(undefined);

/**
 * @type {import("@preact/signals").Signal<WeatherData|undefined>}
 */
export const LATEST_OBSERVATION = computed(() => {
    // Prefer the latest FMI/Roads observation
    const obs = OBSERVATIONS.value[0];
    if (obs && hasValidWindData(obs)) {
        return obs;
    }

    // If no valid recent observation, check the latest METAR
    const metar = METARS.value?.[0];
    if (!metar) {
        return undefined; // No recent observation or METAR
    }

    const speed = metar.wind.speed;
    const gust = metar.wind.gust;

    /** @type {WeatherData} */
    const metarObs = {
        source: "metar", // Use "metar" literal type
        lowCloudCover: undefined, // METAR parsing handles clouds differently, not directly as cover %
        middleCloudCover: undefined,
        // Use temperature/dewPoint from observation if available, otherwise from METAR
        temperature: obs?.temperature ?? metar.temperature,
        // METAR dewpoint might be nullish, use obs if metar's is nullish
        dewPoint: isNullish(metar.dewPoint)
            ? (obs?.dewPoint ?? undefined)
            : metar.dewPoint,
        time: metar.time,
        // METAR wind is in knots, convert to m/s if not nullish
        gust: isNullish(gust) ? undefined : knotsToMs(gust),
        speed: isNullish(speed) ? undefined : knotsToMs(speed),
        // METAR direction is number or 'VRB'/'///', convert to number if possible
        direction:
            typeof metar.wind.direction === "number"
                ? metar.wind.direction
                : undefined, // Or potentially handle 'VRB' if needed
    };

    // Only return the METAR-based observation if it has valid wind data
    if (hasValidWindData(metarObs)) {
        return metarObs;
    }

    return undefined; // METAR didn't have valid wind data either
});

/**
 * @type {import("@preact/signals").Signal<WeatherData[]>}
 */
export const FORECASTS = signal([]);

/**
 * @type {import("@preact/signals").Signal<WeatherData|undefined>}
 */
export const SINGLE_FORECAST = computed(() => {
    // Find the first forecast entry that is at least 2 hours in the future
    const inTwoHours = Date.now() + 2 * 60 * 60 * 1000;
    return FORECASTS.value.find((/** @type {WeatherData} */ fore) => {
        return fore.time.getTime() > inTwoHours;
    });
});

/**
 * @type {import("@preact/signals").Signal<number>}
 */
export const GUST_TREND = computed(() => {
    const latestGust = LATEST_OBSERVATION.value?.gust; // Use LATEST_OBSERVATION which includes METAR
    if (isNullish(latestGust)) {
        return 0; // Cannot calculate trend without latest gust
    }

    // Consider forecasts within the next hour
    const maxAge = Date.now() + 1000 * 60 * 60;
    const recentForecastGusts = FORECASTS.value.flatMap(
        (/** @type {WeatherData} */ point) => {
            if (point.time.getTime() <= maxAge && !isNullish(point.gust)) {
                // Ensure we return number[]
                return typeof point.gust === "number" ? [point.gust] : [];
            }
            return [];
        },
    );

    if (recentForecastGusts.length === 0) {
        return 0; // Cannot calculate trend without recent forecast gusts
    }

    const sum = recentForecastGusts.reduce(
        (/** @type {number} */ sum, /** @type {number} */ gust) => sum + gust,
        0,
    );
    const avg = sum / recentForecastGusts.length;

    // Trend is difference between average recent forecast gust and latest observation gust
    // Positive value means increasing trend, negative means decreasing trend
    return avg - latestGust;
});

/**
 * @type {import("@preact/signals").Signal<MetarData[] | undefined>}
 */
export const METARS = signal(undefined);

/**
 * @type {import("@preact/signals").Signal<string|null>}
 */
export const STATION_COORDINATES = signal(null);

/**
 * @type {import("@preact/signals").Signal<string|null>}
 */
export const FORECAST_COORDINATES = signal(null);

// Set initial forecast coordinates from query params if available
if (QUERY_PARAMS.value.lat && QUERY_PARAMS.value.lon) {
    FORECAST_COORDINATES.value = `${QUERY_PARAMS.value.lat},${QUERY_PARAMS.value.lon}`;
}

/**
 * @type {import("@preact/signals").Signal<string|null>}
 */
export const FORECAST_LOCATION_NAME = signal(null);

/**
 * @type {import("@preact/signals").Signal<string[]>}
 */
export const ERRORS = signal([]);

/**
 *  How many days in the future the forecast is for.
 *  0 = today, 1 = tomorrow, 2 = day after tomorrow, etc.
 * @type {import("@preact/signals").Signal<number>}
 */
export const FORECAST_DAY = computed(() => {
    const day = safeParseNumber(QUERY_PARAMS.value.forecast_day).value;
    return typeof day === "number" && !isNaN(day) && day >= 0
        ? Math.floor(day)
        : 0;
});

// Effect to save current location if 'save' param is present
effect(() => {
    if (!QUERY_PARAMS.value.save) {
        return;
    }

    // Determine the name to use for saving
    const name =
        NAME.value ??
        QUERY_PARAMS.value.name ??
        QUERY_PARAMS.value.icaocode ??
        QUERY_PARAMS.value.fmisid ??
        QUERY_PARAMS.value.roadsid;

    if (!name) {
        addError(
            "Ei nimeä tallennettavalle sijainnille. Anna nimi QueryParametrilla 'name'.",
        );
        navigateQs({ save: undefined }, { replace: true }); // Remove the save param
        return;
    }

    saveCurrentDz(name);
    // Remove the save param from URL after saving
    navigateQs({ save: undefined }, { replace: true });
});

/**
 * @type {import("@preact/signals").Signal<Date>}
 */
export const FORECAST_DATE = computed(() => {
    const day = FORECAST_DAY.value;

    // Mark forecasts as stale whenever the forecast day changes
    STALE_FORECASTS.value = true;

    const date = new Date();
    date.setDate(date.getDate() + day);
    // Reset time to start of the day for clarity if needed, though not strictly necessary for FMI API starttime/endtime
    // date.setHours(0, 0, 0, 0);
    return date;
});

/**
 * @type {import("@preact/signals").Signal<{ [K in StoredQuery]?: string}>}
 */
export const RAW_DATA = signal({});

/** @type {ReturnType<typeof setTimeout>|undefined} */
let timer;

// Effect to clear hovered observation after a timeout
HOVERED_OBSERVATION.subscribe(() => {
    clearTimeout(timer);

    if (HOVERED_OBSERVATION.value !== undefined) {
        timer = setTimeout(() => {
            HOVERED_OBSERVATION.value = undefined;
        }, 5_000); // 5 seconds timeout
    }
});

// Clear hovered observation if user clicks outside the chart area
document.addEventListener("click", (e) => {
    // Check if the click target or any of its ancestors are a .chart element
    if (e.target instanceof Element && !e.target.closest(".chart")) {
        HOVERED_OBSERVATION.value = undefined;
    }
});

/**
 * Makes a request to the FMI API with the given options.
 * @param {StoredQuery} storedQuery - The stored query ID for the request.
 * @param {Object.<string, any>} params - The parameters for the request.
 * @param {string} [mock] - Optional mock URL for local testing.
 * @returns {Promise<Document|undefined|"error">} The parsed XML document from the response, undefined for 404, or "error" for other failures.
 */
export async function fmiRequest(storedQuery, params, mock) {
    // Only allow mock data if 'mock' param is in the actual URL
    const allowMock = new URL(location.href).searchParams.has("mock");
    const baseUrl =
        allowMock && mock
            ? mock
            : `https://opendata.fmi.fi/wfs?request=getFeature`;
    const requestUrl = new URL(baseUrl); // Ensure it's a URL object

    // Add stored query param if not using mock
    if (!allowMock || !mock) {
        requestUrl.searchParams.set("storedquery_id", storedQuery);
    }

    // Add other parameters
    for (const [k, v] of Object.entries(params)) {
        // Ensure non-nullish values are set
        if (v !== undefined && v !== null) {
            requestUrl.searchParams.set(k, String(v)); // Convert values to string for search params
        }
    }

    LOADING.value += 1;
    try {
        debug("FMI Request URL:", requestUrl.toString());
        const response = await fetch(requestUrl);

        debug("FMI Response Status:", response.status);

        if (response.status === 404) {
            debug(`FMI Request 404 for ${storedQuery} with params`, params);
            return undefined; // Not found
        }

        if (!response.ok) {
            console.error(
                `FMI Request failed: ${response.status} ${response.statusText}`,
                requestUrl.toString(),
            );
            return "error"; // Other HTTP errors
        }

        let data;
        try {
            const text = await response.text();
            // Store raw data for potential debugging
            RAW_DATA.value = {
                ...RAW_DATA.value,
                [storedQuery]: text,
            };
            const parser = new DOMParser();
            data = parser.parseFromString(text, "application/xml");

            // Check for FMI error messages in XML
            if (data.querySelector("Exception")) {
                const exceptionText =
                    data.querySelector("ExceptionText")?.textContent ||
                    "Unknown FMI error";
                console.error(
                    "FMI XML Exception:",
                    exceptionText,
                    requestUrl.toString(),
                    data,
                );
                // Return error or potentially throw? Let's return "error" for consistency.
                return "error";
            }
        } catch (error) {
            console.error(
                "Error parsing FMI XML response:",
                requestUrl.toString(),
                error,
            );
            return "error"; // Parsing errors
        }

        return data; // Success
    } catch (error) {
        console.error(
            "Fetch error for FMI request:",
            requestUrl.toString(),
            error,
        );
        return "error"; // Network errors etc.
    } finally {
        LOADING.value -= 1; // Decrement loading counter regardless of outcome
    }
}

/**
 * Helper to evaluate XPath on a Document.
 * @param {Document} doc - The XML document.
 * @param {string} path - The XPath expression.
 * @returns {Element|null} The first element matching the XPath, or null.
 */
function xpath(doc, path) {
    // Ensure doc and doc.evaluate exist
    if (!doc || typeof doc.evaluate !== "function") {
        console.error("xpath called with invalid document:", doc);
        return null;
    }

    const node = doc.evaluate(
        path,
        doc,
        // Namespace resolver function
        function (prefix) {
            switch (prefix) {
                case "wml2":
                    return "http://www.opengis.net/waterml/2.0";
                case "gml":
                    return "http://www.opengis.net/gml/3.2";
                case "xlink": // Add xlink namespace for attributes
                    return "http://www.w3.org/1999/xlink";
                case "om": // Add om namespace if needed for observation metadata
                    return "http://www.opengis.net/om/2.0";
                default:
                    return null;
            }
        },
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;

    // Ensure the result is an Element before returning
    if (node instanceof Element) {
        return node;
    }

    return null; // Node not found or not an Element
}

/**
 * Converts XML <point> elements from a MeasurementTimeseries node into an array of TimeValuePair.
 * @param {Element} node - The MeasurementTimeseries XML element.
 * @param {number} fallbackValue - Value to use if <value> is missing or invalid.
 * @param {Date} fallbackTime - Time to use if <time> is missing or invalid (defaults to current time).
 * @returns {TimeValuePair[]} Array of { value, time } objects.
 */
function pointsToTimeSeries(node, fallbackValue, fallbackTime = new Date()) {
    // Ensure node is a valid Element
    if (!node || !(node instanceof Element)) {
        console.warn("pointsToTimeSeries called with invalid node:", node);
        return [];
    }

    const timeSeries = [];
    // Select all 'wml2:MeasurementTVP/wml2:TVP/wml2:point' elements within the node
    // Or simply querySelectorAll('point') if the node is already the series element
    // Let's assume node is the <wml2:MeasurementTimeseries>
    const pointNodes = node.querySelectorAll("point");

    for (const point of Array.from(pointNodes)) {
        const valueElement = point.querySelector("value");
        const timeElement = point.querySelector("time");

        const value = safeParseNumber(
            valueElement?.textContent ?? undefined,
        ).value; // Ensure undefined if null
        const timeString = timeElement?.textContent;
        const time = timeString ? new Date(timeString) : fallbackTime;

        // Only add a point if time is valid, value can be fallback
        if (!isNaN(time.getTime())) {
            timeSeries.push({
                value: typeof value === "number" ? value : fallbackValue,
                time: time,
            });
        } else {
            console.warn(
                "Skipping timeseries point due to invalid time:",
                timeString,
                point,
            );
        }
    }

    return timeSeries;
}

/**
 * Parses a specific MeasurementTimeseries from a Document using its gml:id.
 * @param {Document | undefined} doc - The XML document (or undefined).
 * @param {string} id - The gml:id of the MeasurementTimeseries.
 * @param {number} fallback - The fallback value for points if value is missing.
 * @returns {TimeValuePair[]} Array of { value, time } objects.
 */
function parseTimeSeries(doc, id, fallback) {
    // Ensure doc is a valid Document before proceeding
    if (!doc || !(doc instanceof Document)) {
        debug(
            `parseTimeSeries called with invalid or missing document for id: ${id}`,
        );
        return [];
    }
    // Find the timeseries node using XPath
    const node = xpath(doc, `//wml2:MeasurementTimeseries[@gml:id="${id}"]`);
    if (!node) {
        debug(`TimeSeries node not found for id: ${id}`);
        return [];
    }

    // Parse points from the found node
    return pointsToTimeSeries(node, fallback);
}

/**
 * Parses METAR data from IWXXM XML document.
 * @param {Document} xml - The IWXXM XML document.
 * @returns {MetarData[]} Array of parsed MetarData objects.
 */
function parseCloudsXml(xml) {
    if (!xml || !(xml instanceof Document)) {
        console.error("parseCloudsXml called with invalid document:", xml);
        return [];
    }
    // Select the observation report elements
    const members = Array.from(
        xml.querySelectorAll("MeteorologicalAerodromeObservationReport"),
    );

    const parsedMetars = members
        .map((report) => {
            // Find the time element
            const timePosition =
                report.querySelector("timePosition")?.textContent;
            const time = timePosition ? new Date(timePosition) : new Date();

            // Find station elevation (optional)
            const fieldElevationElement =
                report.querySelector("fieldElevation");
            const elevation = safeParseNumber(
                fieldElevationElement?.textContent ?? undefined, // Ensure undefined if null
            ).value;

            // Find the observation result body
            const result = report.querySelector("result observation result"); // XPath might be better: //om:result/om:Observation/om:result

            // Find wind data
            const wind = result?.querySelector("wind"); // XPath: //om:result/om:Observation/om:result/aixm:AerodromeSurfaceWind
            const windSpeedElement = wind?.querySelector("meanWindSpeed value"); // XPath: .../aixm:meanWindSpeed/gml:Measure.value
            const windGustElement = wind?.querySelector("windGust value"); // XPath: .../aixm:windGust/gml:Measure.value
            const windDirectionElement = wind?.querySelector(
                "meanWindDirection value",
            ); // XPath: .../aixm:meanWindDirection/gml:Measure.value
            const windUnitElement = wind?.querySelector("meanWindSpeed unit"); // XPath: .../aixm:meanWindSpeed/gml:Measure.uom

            const windSpeed = safeParseNumber(
                windSpeedElement?.textContent ?? undefined, // Ensure undefined if null
            ).value;
            const windGust = safeParseNumber(
                windGustElement?.textContent ?? undefined, // Ensure undefined if null
            ).value;
            const windDirection = safeParseNumber(
                windDirectionElement?.textContent ?? undefined, // Ensure undefined if null
            ).value; // Direction can be number or VRB
            const windUnit = windUnitElement?.textContent ?? "kt"; // Default unit is knots for aviation

            // Find temperature and dew point
            const airTemperatureElement = result?.querySelector(
                "airTemperature value",
            ); // XPath: .../aixm:airTemperature/gml:Measure.value
            const dewPointElement = result?.querySelector("dewpoint value"); // XPath: .../aixm:dewpoint/gml:Measure.value

            const temperature = safeParseNumber(
                airTemperatureElement?.textContent ?? undefined, // Ensure undefined if null
            ).value;
            const dewPoint = safeParseNumber(
                dewPointElement?.textContent ?? undefined, // Ensure undefined if null
            ).value;

            // Find the raw METAR text (if available, often in source element)
            const metarSourceElement = report.querySelector(
                "extension source input",
            ); // Check common paths
            const metarText = metarSourceElement?.textContent;

            // Find clouds
            const cloudNodes = result?.querySelectorAll("cloud CloudLayer"); // XPath: .../aixm:cloud/aixm:CloudLayer

            const clouds = Array.from(cloudNodes ?? []).flatMap((xmlCloud) => {
                const baseElement = xmlCloud.querySelector("base value"); // XPath: .../aixm:base/gml:Measure.value
                const amountElement = xmlCloud.querySelector("amount"); // XPath: .../aixm:amount
                const amountHref = amountElement?.getAttribute("xlink:href");

                // Base is mandatory for a valid layer description
                if (isNullish(baseElement?.textContent) || !amountHref) {
                    debug(
                        "Skipping cloud layer due to missing base or amount href",
                        xmlCloud,
                    );
                    return [];
                }

                const base = safeParseNumber(baseElement.textContent).value;

                // Extract amount code from the href
                const amountCode = amountHref.split("/").pop(); // e.g. "1", "2", "3", "4"

                /** @type {Record<string, string>} */
                const cloudAmounts = {
                    0: "NSC", // No Significant Cloud
                    1: "FEW", // Few
                    2: "SCT", // Scattered
                    3: "BKN", // Broken
                    4: "OVC", // Overcast
                    // Add other codes if needed: 5=vertical_visibility, 6=obscured, 7=missing
                };

                const amount =
                    cloudAmounts[amountCode ?? ""] ?? amountCode ?? "UNK"; // Use code if mapping not found

                // Check for CB specifically (Cumulonimbus)
                const cloudTypeElement = xmlCloud.querySelector("cloudType"); // XPath: .../aixm:cloudType
                const cloudTypeHref =
                    cloudTypeElement?.getAttribute("xlink:href");
                const isCB = cloudTypeHref?.endsWith("/CB") ?? false;

                // If it's a CB layer, the amount might be different or implied by type.
                // For simplicity, let's just mark the whole observation if CB is present anywhere.

                /** @type {CloudLayer} */
                const cloudLayer = {
                    amount: amount,
                    base: typeof base === "number" ? base : undefined, // Base can be undefined if parsing failed but element existed
                    href: amountHref, // Keep href for reference
                    type: isCB ? "CB" : undefined, // Indicate if this specific layer is CB
                };
                return [cloudLayer];
            });

            // Check for CB presence anywhere in the report (often part of the metar text or specific elements)
            const hasCB =
                /[^ ]CB($| )/.test(metarText ?? "") ||
                clouds.some((c) => c.type === "CB");

            /** @type {MetarData} */
            const metarData = {
                time: time,
                metar: metarText ?? "N/A",
                cb: hasCB, // Check if CB is mentioned or detected in layers
                wind: {
                    // Ensure wind values are numbers or undefined
                    gust: typeof windGust === "number" ? windGust : undefined,
                    speed:
                        typeof windSpeed === "number" ? windSpeed : undefined,
                    // Direction can be a number or 'VRB'. Store as string if not number.
                    direction:
                        typeof windDirection === "number"
                            ? windDirection
                            : (windDirectionElement?.textContent ?? "VRB"),
                    unit: windUnit.toLowerCase(),
                },
                temperature:
                    typeof temperature === "number" ? temperature : undefined, // Temp might be missing
                dewPoint: typeof dewPoint === "number" ? dewPoint : undefined, // Dew point might be missing
                clouds: clouds,
                elevation:
                    typeof elevation === "number" ? elevation : undefined,
            };

            return metarData;
        })
        .filter(
            (/** @type {MetarData | undefined} */ metar) =>
                metar && !isNaN(metar.time.getTime()),
        ); // Filter out entries with invalid times or undefined

    // @ts-ignore - We filtered undefined above, but TS might not infer it perfectly
    return parsedMetars.sort((a, b) => b.time.getTime() - a.time.getTime()); // Sort descending by time (latest first)
}

/**
 * Adds an error message to the ERRORS signal.
 * @param {string} msg - The error message.
 */
export function addError(msg) {
    console.error("Error:", msg); // Log the error to console
    // Avoid adding duplicate errors if called rapidly
    if (ERRORS.value.includes(msg)) {
        return;
    }
    ERRORS.value = [...ERRORS.value, msg];
}

/**
 * Fetches forecast data from the FMI API using coordinates.
 * @param {string} coordinates - Coordinates in "lat,lon" format.
 */
async function fetchFmiForecasts(coordinates) {
    const forecastRange =
        safeParseNumber(QUERY_PARAMS.value.forecast_range).value ?? 12;

    // Calculate start and end times based on FORECAST_DAY and forecastRange
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const forecastDate = new Date(startOfToday);
    forecastDate.setDate(startOfToday.getDate() + FORECAST_DAY.value);

    let forecastStartTime;
    let forecastEndTime;

    if (FORECAST_DAY.value === 0) {
        // For today, start from now + a little buffer, end in `forecastRange` hours
        forecastStartTime = new Date(now.getTime() - 5 * 60 * 1000); // Start slightly in the past to catch recent
        forecastEndTime = new Date(
            now.getTime() + forecastRange * 60 * 60 * 1000,
        );
    } else {
        // For future days, use fixed range (e.g., 07:00 to 21:00) on that specific date
        forecastStartTime = new Date(forecastDate);
        forecastStartTime.setHours(7, 0, 0, 0); // Start of forecast day

        forecastEndTime = new Date(forecastDate);
        forecastEndTime.setHours(21, 0, 0, 0); // End of forecast day

        // Ensure end time is after start time, potentially spanning midnight if 21:00 is next day
        if (forecastEndTime <= forecastStartTime) {
            forecastEndTime.setDate(forecastEndTime.getDate() + 1);
        }
    }

    // FMI API often caches based on time, use a cache buster for more frequent updates
    const cacheBust = Math.floor(Date.now() / (5 * 60 * 1000)); // New value every 5 minutes

    const forecastXml = await fmiRequest(
        "fmi::forecast::edited::weather::scandinavia::point::timevaluepair",
        {
            cch: cacheBust, // Custom cache buster parameter (not standard WFS but FMI uses it)
            starttime: forecastStartTime.toISOString(),
            endtime: forecastEndTime.toISOString(),
            timestep: 10, // 10 minute steps is common for this query
            parameters: [
                "HourlyMaximumGust", // Puuska (max tunnissa) m/s
                "WindDirection", // Tuulensuunta asteina
                "WindSpeedMS", // Keskinopeus m/s
                "LowCloudCover", // Alapilvisyys % (0-100)
                "MiddleAndLowCloudCover", // Keski- ja alapilvisyys % (0-100)
                "Temperature", // Lämpötila C
                "DewPoint", // Kastepiste C
                "PoP", // Sateen todennäköisyys %
            ].join(","),
            latlon: coordinates,
        },
        // "/example_data/forecast.xml", // Example mock path
    );

    if (forecastXml === "error") {
        addError("Virhe ennusteiden hakemisessa Ilmatieteenlaitokselta.");
        return;
    }

    // Check only if the XML document itself is missing or invalid
    if (!forecastXml) {
        addError(
            "Ilmatieteenlaitoksen ennusteita ei löytynyt annetuilla parametreilla tai alueelle. Vastaus oli tyhjä.",
        );
        FORECASTS.value = []; // Clear previous forecasts if none found
        FORECAST_LOCATION_NAME.value = null;
        return;
    }

    // Parse each time series by its gml:id
    // Find gml:id values - these might change based on parameters or FMI updates!
    // You can inspect the raw XML or rely on common IDs if known.
    // Assuming common IDs based on the 'parameters' requested:
    const gustForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-HourlyMaximumGust",
        -1,
    );
    const speedForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-WindSpeedMS",
        -1,
    );
    const popForecasts = parseTimeSeries(forecastXml, "mts-1-1-PoP", 0);
    const temperatureForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-Temperature",
        -100,
    );
    const dewPointForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-DewPoint",
        -100,
    );
    const directionForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-WindDirection",
        -1,
    );
    const lowCloudCoverForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-LowCloudCover",
        -1,
    );
    const middleCloudCoverForecasts = parseTimeSeries(
        forecastXml,
        "mts-1-1-MiddleAndLowCloudCover",
        -1,
    );

    // Find location name from the forecast response
    const locationCollection = forecastXml.querySelector("LocationCollection");
    const locationName = locationCollection?.querySelector("name")?.textContent;
    const regionName = locationCollection?.querySelector("region")?.textContent;

    // Update location name signal
    if (locationName) {
        FORECAST_LOCATION_NAME.value = regionName
            ? `${locationName}, ${regionName}`
            : locationName;
        // Set NAME signal if it hasn't been set by fmisid/roadsid/icaocode
        if (!NAME.value) {
            NAME.value = locationName;
        }
    } else {
        FORECAST_LOCATION_NAME.value = coordinates; // Fallback to coordinates if name not found
    }

    // Combine the parsed time series into WeatherData objects
    // We assume all time series have the same timestamps and order.
    // Use gustForecasts as the base as it's often the primary focus.
    const combinedForecasts = gustForecasts
        .map((gustEntry) => {
            const time = gustEntry.time;

            // Find corresponding entries in other time series by time
            const speedEntry = speedForecasts.find(
                (s) => s.time.getTime() === time.getTime(),
            );
            const directionEntry = directionForecasts.find(
                (d) => d.time.getTime() === time.getTime(),
            );
            const popEntry = popForecasts.find(
                (p) => p.time.getTime() === time.getTime(),
            );
            const tempEntry = temperatureForecasts.find(
                (t) => t.time.getTime() === time.getTime(),
            );
            const dewPointEntry = dewPointForecasts.find(
                (dp) => dp.time.getTime() === time.getTime(),
            );
            const lowCloudEntry = lowCloudCoverForecasts.find(
                (lc) => lc.time.getTime() === time.getTime(),
            );
            const middleCloudEntry = middleCloudCoverForecasts.find(
                (mc) => mc.time.getTime() === time.getTime(),
            );

            /** @type {WeatherData} */
            const forecastData = {
                source: "forecast", // Use literal type
                // Use >= 0 checks for wind/direction, > -99 for temp/dewpoint
                gust: gustEntry.value >= 0 ? gustEntry.value : undefined,
                direction:
                    directionEntry && directionEntry.value >= 0
                        ? directionEntry.value
                        : undefined,
                speed:
                    speedEntry && speedEntry.value >= 0
                        ? speedEntry.value
                        : undefined,
                time: time,
                lowCloudCover:
                    lowCloudEntry && lowCloudEntry.value >= 0
                        ? lowCloudEntry.value
                        : undefined,
                middleCloudCover:
                    middleCloudEntry && middleCloudEntry.value >= 0
                        ? middleCloudEntry.value
                        : undefined,
                rain:
                    popEntry && popEntry.value >= 0
                        ? popEntry.value
                        : undefined,
                temperature:
                    tempEntry && tempEntry.value > -99
                        ? tempEntry.value
                        : undefined,
                dewPoint:
                    dewPointEntry && dewPointEntry.value > -99
                        ? dewPointEntry.value
                        : undefined,
            };
            return forecastData;
        })
        .filter(
            (/** @type {WeatherData} */ forecast) =>
                hasValidWindData(forecast) ||
                forecast.temperature !== undefined ||
                forecast.dewPoint !== undefined,
        ); // Keep entries that have at least some useful data

    FORECASTS.value = combinedForecasts;
    STALE_FORECASTS.value = false; // Mark forecasts as fresh
}

/**
 * Fetches METAR data from the FMI API for a given ICAO code.
 * @param {string} icaocode - The ICAO code of the airport.
 * @param {Date} startTime - The start time for observations.
 * @param {number} cacheBust - Cache busting parameter.
 */
async function fetchFmiMetar(icaocode, startTime, cacheBust) {
    if (!icaocode) {
        debug("fetchFmiMetar called without icaocode");
        METARS.value = undefined; // Clear previous METARs
        return;
    }

    const xml = await fmiRequest(
        "fmi::avi::observations::iwxxm", // Stored query for aviation observations (METAR/TAF in IWXXM)
        {
            cch: cacheBust,
            starttime: startTime.toISOString(),
            // endtime: new Date().toISOString(), // Can set an end time if needed
            icaocode: icaocode.toUpperCase(), // Ensure ICAOCode is uppercase
        },
        // "/example_data/metar.xml", // Example mock path
    );

    if (xml === "error") {
        addError(
            `Virhe Ilmatieteenlaitoksen METAR-sanomaa hakiessa kentälle ${icaocode}.`,
        );
        METARS.value = undefined;
        return;
    }

    if (
        !xml ||
        !xml.querySelector("MeteorologicalAerodromeObservationReport")
    ) {
        // Check for the report element
        debug(`No METAR reports found for ICAO ${icaocode}`);
        // addError(`Tuntematon lentokentän tunnus ${icaocode} tai ei METAR-tietoja.`); // Maybe too strong message if just no recent data
        METARS.value = []; // Set to empty array if no data found
        return;
    }

    const parsedMetars = parseCloudsXml(xml);
    METARS.value = parsedMetars; // Update signal with parsed data
}

/**
 * Fetches METAR data from the Flyk API for a given ICAO code.
 * Flyk provides only the latest METAR message string.
 * @param {string} icaocode - The ICAO code of the airport.
 */
async function fetchFlykMetar(icaocode) {
    if (!icaocode) {
        debug("fetchFlykMetar called without icaocode");
        METARS.value = undefined;
        return;
    }
    debug(`Fetching Flyk METAR for ${icaocode}`);
    try {
        /** @type {FlykMetar|undefined} */
        // Note: This endpoint might return data for *all* stations, need to filter.
        // It might also be rate-limited or require specific usage policies.
        const data = await fetchJSON("https://flyk.com/api/metars.geojson");

        if (!data || !data.features) {
            debug("Flyk API returned no data or invalid format", data);
            addError("Virhe Flyk METAR -tietojen hakemisessa.");
            METARS.value = undefined;
            return;
        }

        // Find the feature corresponding to the ICAO code
        const re = new RegExp(`^(METAR|SPECI) ${icaocode.toUpperCase()} `);
        const feature = data.features.find(
            (/** @type {FlykMetarFeature} */ f) => {
                return f.properties?.text && re.test(f.properties.text);
            },
        );

        const metarText = feature?.properties?.text; // Add optional chaining for properties

        if (metarText) {
            debug(`Found Flyk METAR for ${icaocode}:`, metarText);
            setMETARSfromMetarMessage([metarText]); // Parse and set the single METAR message
        } else {
            debug(`No Flyk METAR found for ${icaocode}`);
            addError(`Ei Flyk METAR-sanomaa kentälle ${icaocode}.`);
            METARS.value = []; // Set to empty array if not found
        }
    } catch (error) {
        console.error("Error fetching or processing Flyk METAR:", error);
        addError(
            `Virhe Flyk METAR-sanomaa hakiessa kentälle ${icaocode}: ${error instanceof Error ? error.message : String(error)}`,
        );
        METARS.value = undefined;
    }
}

/**
 * Parses raw METAR message strings and sets the METARS signal.
 * Assumes `parseMETAR` global function is available from "metar" import.
 * @param {string[]} metars - Array of raw METAR message strings.
 */
function setMETARSfromMetarMessage(metars) {
    if (!metars || metars.length === 0) {
        METARS.value = []; // Use empty array instead of undefined for consistency
        return;
    }

    // Check if parseMETAR global is available
    // @ts-ignore
    if (typeof parseMETAR !== "function") {
        console.error(
            "METAR parsing library not loaded correctly. 'parseMETAR' function is not available.",
        );
        addError("METAR-kirjasto puuttuu. METAR-tietoja ei voida näyttää.");
        METARS.value = undefined; // Cannot parse
        return;
    }

    const parsed = metars
        .map((metar) => {
            try {
                // @ts-ignore (parseMETAR is a global from the import)
                const m = parseMETAR(metar);

                // Check if parsing was successful and resulted in a valid structure
                if (!m || !m.time || !m.wind) {
                    console.warn(`Failed to parse METAR: ${metar}`, m);
                    return null; // Return null for invalid messages
                }

                /** @type MetarData */
                const metarData = {
                    time: new Date(m.time),
                    metar: metar,
                    // Check for CB using regex or parsed data if available
                    cb:
                        /[^ ]CB /.test(metar) ||
                        (m.clouds?.some(
                            (/** @type {{ abbreviation: string; }} */ c) =>
                                c.abbreviation === "CB",
                        ) ??
                            false),
                    wind: {
                        // Ensure values are numbers or undefined
                        gust:
                            typeof m.wind.gust === "number"
                                ? m.wind.gust
                                : undefined,
                        speed:
                            typeof m.wind.speed === "number"
                                ? m.wind.speed
                                : undefined,
                        // Direction can be number or string ('VRB', '///')
                        direction: m.wind.direction,
                        unit: m.wind.unit?.toLowerCase() ?? "kt", // Default unit
                    },
                    // Ensure temperature/dewpoint are numbers or undefined
                    temperature:
                        typeof m.temperature === "number"
                            ? m.temperature
                            : undefined,
                    dewPoint:
                        typeof m.dewpoint === "number" ? m.dewpoint : undefined,
                    clouds:
                        m.clouds?.map(
                            (
                                /** @type {MetarCloud} */ cloud, // Use local type
                            ) => {
                                /** @type {CloudLayer} */
                                const layer = {
                                    amount: cloud.abbreviation,
                                    base:
                                        typeof cloud.altitude === "number"
                                            ? cloud.altitude // parseMETAR already returns feet
                                            : undefined,
                                    // Add other cloud details if parseMETAR provides them (e.g., type)
                                };
                                return layer;
                            },
                        ) ?? [],
                    // Add elevation if parseMETAR provides it
                    elevation:
                        typeof m.elevation === "number"
                            ? m.elevation
                            : undefined,
                };

                return metarData;
            } catch (error) {
                console.error(`Error parsing METAR message "${metar}":`, error);
                return null; // Return null for messages that cause parsing errors
            }
        })
        .filter(
            /** @type {(item: MetarData | null) => item is MetarData} */
            (item) => item !== null,
        ) // Filter out messages that failed to parse
        .sort((a, b) => b.time.getTime() - a.time.getTime()); // Sort descending by time

    METARS.value = parsed;
}

// Helper function to calculate the observation start time based on range param
function getObservationStartTime() {
    const obsRange =
        safeParseNumber(QUERY_PARAMS.value.observation_range).value ?? 12;
    const obsStartTime = new Date();
    obsStartTime.setHours(obsStartTime.getHours() - obsRange);
    // Optional: reset minutes/seconds for cleaner intervals if needed, but API handles ISO string
    // obsStartTime.setMinutes(0, 0, 0);
    return obsStartTime;
}

/**
 * Fetches observation data from the FMI API for a given FMISID.
 * @param {string} fmisid - The FMISID of the station.
 */
export async function fetchFmiObservations(fmisid) {
    if (!fmisid) {
        debug("fetchFmiObservations called without fmisid");
        OBSERVATIONS.value = [];
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
        return;
    }

    const icaocode = QUERY_PARAMS.value.icaocode;
    const customName = QUERY_PARAMS.value.name;

    // Set NAME signal based on available parameters, preferring custom name
    NAME.value = customName || icaocode || fmisid || undefined;
    if (NAME.value) {
        localStorage.setItem("previous_dz", NAME.value); // Save for future use
    }

    const obsStartTime = getObservationStartTime();

    // FMI API often caches based on time, use a cache buster
    const cacheBust = Math.floor(Date.now() / (5 * 60 * 1000)); // New value every 5 minutes

    // Fetch METAR if ICAO code is provided
    if (icaocode) {
        // Use `await` here to ensure METARs are loaded before we potentially rely on them
        // or let it run in background with .then(). Let's await for now for simpler logic flow.
        if (QUERY_PARAMS.value.flyk_metar) {
            await fetchFlykMetar(icaocode);
        } else {
            await fetchFmiMetar(icaocode, obsStartTime, cacheBust);
        }
    } else {
        debug("No ICAO code provided, skipping METAR fetch.");
        METARS.value = undefined; // Clear previous METARs if no ICAO code
        // addError("Ei METAR tietoja. Anna ICAO-koodi QueryParametrilla 'icaocode'."); // Optional: inform user
    }

    // Fetch standard weather observations from FMI
    const fmiParams = {
        cch: cacheBust,
        starttime: obsStartTime.toISOString(),
        // endtime: new Date().toISOString(), // Can set an end time if needed
        parameters: [
            "winddirection", // Tuulensuunta
            "windspeedms", // Keskinopeus m/s
            "windgust", // Puuska m/s
            "t2m", // Lämpötila C (temperature at 2m)
            "td", // Kastepiste C (dew point)
            // Add other parameters if needed: "n_man", "rh" etc.
        ].join(","),
        fmisid,
    };
    debug(`Calling fmiRequest for observations with params:`, fmiParams);
    const docResult = await fmiRequest(
        "fmi::observations::weather::timevaluepair",
        fmiParams,
        // "/example_data/observations.xml", // Example mock path
    );

    debug(
        `fmiRequest for observations returned:`,
        docResult === "error" ? "error" : docResult ? "Document" : "undefined",
    );

    if (docResult === "error") {
        addError(
            `Virhe Ilmatieteenlaitoksen havaintoaseman ${fmisid} tietojen hakemisessa.`,
        );
        OBSERVATIONS.value = []; // Clear observations on error
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
        return;
    }
    // Check if docResult is a Document before proceeding
    if (!docResult) {
        addError(
            `Ilmatieteenlaitoksen havaintoaseman ${fmisid} tietoja ei löytynyt tai vastaus oli tyhjä.`,
        );
        OBSERVATIONS.value = []; // Clear observations if no document
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
        return;
    }
    // Now we know docResult is a Document
    const doc = docResult;

    // Try to find station name and coordinates from the document
    const nameElement = xpath(
        doc,
        "//gml:name[@codeSpace='http://xml.fmi.fi/namespace/locationcode/name']", // XPath for location name
    );
    const stationName = nameElement?.textContent;

    if (!stationName) {
        // This should ideally not happen if timeseries were found, but good check
        addError(
            `Ilmatieteenlaitoksen havaintoasema ${fmisid} löytyi, mutta nimeä ei saatu.`,
        );
        STATION_NAME.value = `FMISID ${fmisid} (Nimetön FMI)`; // Fallback name
    } else {
        STATION_NAME.value = `${stationName} (FMI)`;
    }

    // Find station coordinates
    // Use a simpler selector, similar to orig_data.js, which might be more robust
    const posElement = doc.querySelector("gml\\:pos"); // Try with namespace first
    let coordsText = posElement?.textContent?.trim();

    // Fallback to querying without namespace if the first attempt fails
    if (!coordsText) {
        const posElementNoNs = doc.querySelector("pos");
        coordsText = posElementNoNs?.textContent?.trim();
    }

    if (coordsText) {
        // Format is typically "lat lon", convert to "lat,lon"
        const parts = coordsText.split(/\s+/);
        if (parts.length === 2) {
            STATION_COORDINATES.value = parts.join(",");
        } else {
            debug(
                `Invalid coordinate format found for FMISID ${fmisid}: ${coordsText}`,
            );
            STATION_COORDINATES.value = null;
        }
    } else {
        debug(
            `Could not find coordinates (gml:pos or pos) for FMISID ${fmisid}`,
        );
        STATION_COORDINATES.value = null;
    }
    debug(
        `Parsed station info: Name='${STATION_NAME.value}', Coords='${STATION_COORDINATES.value}'`,
    );

    // Set forecast coordinates to station coordinates if forecast coordinates are not already set manually
    if (!FORECAST_COORDINATES.value && STATION_COORDINATES.value) {
        debug(
            `Setting FORECAST_COORDINATES from station: ${STATION_COORDINATES.value}`,
        );
        FORECAST_COORDINATES.value = STATION_COORDINATES.value;
    }

    // Parse each time series by its gml:id
    // Pass the validated 'doc' (which is a Document) to parseTimeSeries
    const gusts = parseTimeSeries(doc, "obs-obs-1-1-windgust", -1);
    const windSpeed = parseTimeSeries(doc, "obs-obs-1-1-windspeedms", -1);
    const directions = parseTimeSeries(doc, "obs-obs-1-1-winddirection", -1);
    const temperatures = parseTimeSeries(doc, "obs-obs-1-1-t2m", -99);
    const dewPoints = parseTimeSeries(doc, "obs-obs-1-1-td", -99);

    // Combine the parsed time series into WeatherData objects
    // Assume all time series have the same timestamps and order.
    // Use gusts as the base time series.
    const combined = gusts
        .map((gustEntry) => {
            const time = gustEntry.time;

            // Find corresponding entries in other time series by time
            const speedEntry = windSpeed.find(
                (s) => s.time.getTime() === time.getTime(),
            );
            const directionEntry = directions.find(
                (d) => d.time.getTime() === time.getTime(),
            );
            const tempEntry = temperatures.find(
                (t) => t.time.getTime() === time.getTime(),
            );
            const dewPointEntry = dewPoints.find(
                (dp) => dp.time.getTime() === time.getTime(),
            );

            /** @type {WeatherData} */
            const obsData = {
                source: "fmi", // Use literal type
                // Use >= 0 checks for wind/direction, > -99 for temp/dewpoint
                gust: gustEntry.value >= 0 ? gustEntry.value : undefined,
                speed:
                    speedEntry && speedEntry.value >= 0
                        ? speedEntry.value
                        : undefined,
                direction:
                    directionEntry && directionEntry.value >= 0
                        ? directionEntry.value
                        : undefined,
                time: time,
                lowCloudCover: undefined, // FMI observation query doesn't provide cloud cover % easily here
                middleCloudCover: undefined,
                temperature:
                    tempEntry && tempEntry.value > -99
                        ? tempEntry.value
                        : undefined,
                dewPoint:
                    dewPointEntry && dewPointEntry.value > -99
                        ? dewPointEntry.value
                        : undefined,
            };
            return obsData;
        })
        .filter(
            (/** @type {WeatherData} */ obs) =>
                hasValidWindData(obs) ||
                obs.temperature !== undefined ||
                obs.dewPoint !== undefined,
        ); // Keep entries with at least some useful data

    // FMI observations are usually latest first in the XML, but parseTimeSeries doesn't guarantee order.
    // Let's sort descending by time to ensure latest is first.
    combined.sort((a, b) => b.time.getTime() - a.time.getTime());

    // Apply mocking values if present in query params
    mockAllEntries(combined);

    // Update OBSERVATIONS signal
    OBSERVATIONS.value = combined;
}

/**
 * Helper to apply mocked values from query parameters to observation data.
 * @param {WeatherData[]} target - The array of WeatherData objects to modify.
 */
function mockAllEntries(target) {
    // do not allow mocking on the production site
    if (
        location.hostname === "hyppykeli.fi" &&
        !new URL(location.href).searchParams.has("allow_mock")
    ) {
        return;
    }

    mockEntries({
        target: target,
        targetKey: "direction",
        queryKey: "__directions",
    });

    mockEntries({
        target: target,
        targetKey: "gust",
        queryKey: "__gusts",
    });

    mockEntries({
        target: target,
        targetKey: "speed",
        queryKey: "__speeds",
    });
}

/**
 * Helper to apply a single type of mocked value from query parameters.
 * @template {keyof WeatherData} TKeys
 * @template {keyof QueryParams} QKeys
 *
 * @param {object} params
 * @param {QKeys} params.queryKey - The query parameter key holding the comma-separated mock values.
 * @param {TKeys} params.targetKey - The key in the WeatherData object to apply the mock value to.
 * @param {WeatherData[]} params.target - The array of WeatherData objects to modify.
 */
function mockEntries(params) {
    const mockValues =
        QUERY_PARAMS.value[params.queryKey]
            ?.split(",")
            .map((/** @type {string} */ val) => safeParseNumber(val).value) // Use safeParseNumber
            .filter(
                /** @type {(val: number | null) => val is number} */
                (val) => typeof val === "number" && !isNaN(val),
            ) // Only keep valid numbers
            .reverse() ?? []; // Apply to the latest observations first

    let index = 0;
    for (const mockValue of mockValues) {
        const entry = params.target[index];
        if (entry) {
            // Apply the mock value. Need to assert type or use @ts-ignore because
            // the generic TKeys doesn't guarantee the type matches the mock value (always number here).
            // @ts-ignore - Assigning number to potentially different type property
            entry[params.targetKey] = mockValue;
        }
        index++;
    }
}

/**
 * Fetches station information from Digitraffic for a given road station ID.
 * This is needed to get coordinates and name.
 * @param {string} roadsid - The ID of the road station.
 */
async function fetchRoadStationInfo(roadsid) {
    if (!roadsid) {
        debug("fetchRoadStationInfo called without roadsid");
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
        return;
    }
    debug(`Fetching Digitraffic station info for ${roadsid}`);
    try {
        const url = `https://tie.digitraffic.fi/api/weather/v1/stations/${roadsid}`;
        const res = await fetch(url, {
            headers: {
                "Digitraffic-User": "hyppykeli.fi", // Politeness header
            },
        });

        debug("Digitraffic Station Info Response Status:", res.status, url);

        if (!res.ok) {
            console.error(
                `Digitraffic Station Info Error: ${res.status} ${res.statusText}`,
                url,
            );
            addError(
                `Virhe Digitraffic API:ssa (aseman tiedot ${roadsid}): ${res.status}.`,
            );
            STATION_NAME.value = undefined;
            STATION_COORDINATES.value = null;
            return;
        }

        /** @type {RoadStationInfoDetailed | undefined} */
        const data = await res.json();

        if (
            !data ||
            !data.geometry ||
            !data.geometry.coordinates ||
            !data.properties?.names?.fi
        ) {
            console.error(
                "Digitraffic Station Info invalid data structure",
                data,
                url,
            );
            addError(
                `Digitraffic aseman ${roadsid} tietoja ei saatu tai ne olivat virheellisiä.`,
            );
            STATION_NAME.value = undefined;
            STATION_COORDINATES.value = null;
            return;
        }

        // Coordinates from Digitraffic are [lon, lat], need "lat,lon"
        STATION_COORDINATES.value = `${data.geometry.coordinates[1]},${data.geometry.coordinates[0]}`;

        // Set forecast coordinates to station coordinates if forecast coordinates are not already set manually
        if (!FORECAST_COORDINATES.value && STATION_COORDINATES.value) {
            FORECAST_COORDINATES.value = STATION_COORDINATES.value;
        }

        STATION_NAME.value = data.properties.names.fi + " (Digitraffic)";
        debug(
            `Digitraffic station info loaded for ${roadsid}: ${STATION_NAME.value}, ${STATION_COORDINATES.value}`,
        );

        // Set NAME signal if it hasn't been set by fmisid/icaocode
        if (!NAME.value) {
            NAME.value = data.properties.names.fi;
        }
        if (NAME.value) {
            localStorage.setItem("previous_dz", NAME.value);
        }
    } catch (error) {
        console.error("Error fetching Digitraffic Station Info:", error);
        addError(
            `Virhe Digitraffic API:ssa (aseman tiedot ${roadsid}): ${error instanceof Error ? error.message : String(error)}`,
        );
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
    }
}

/**
 * Fetches latest and historical observation data from Digitraffic for a given road station ID.
 * Parses and sets the OBSERVATIONS signal.
 * Reverts to fetching both /data (latest) and /data/history, similar to orig_data.js.
 * @param {string} roadsid - The ID of the road station.
 */
async function fetchRoadObservations(roadsid) {
    if (!roadsid) {
        debug("fetchRoadObservations called without roadsid");
        OBSERVATIONS.value = [];
        return;
    }
    debug(`Fetching Digitraffic observations for ${roadsid}`);

    const obsStartTime = getObservationStartTime();
    const nowISO = new Date().toISOString();

    // Define URLs for both latest data and history
    const latestDataUrl = `https://tie.digitraffic.fi/api/weather/v1/stations/${roadsid}/data`;
    const historyUrl = new URL(
        `https://tie.digitraffic.fi/api/weather/v1/stations/${roadsid}/data/history`,
    );
    historyUrl.searchParams.set("from", obsStartTime.toISOString());
    // Add 'to' parameter, mirroring orig_data.js, as it might be required by the API
    historyUrl.searchParams.set("to", nowISO);

    const commonHeaders = {
        "Digitraffic-User": "hyppykeli.fi", // Politeness header
    };

    try {
        // Fetch both latest data and history concurrently using Promise.allSettled
        const results = await Promise.allSettled([
            fetchJSON(latestDataUrl, { headers: commonHeaders }),
            fetchJSON(historyUrl.toString(), { headers: commonHeaders }),
        ]);

        const latestResult = results[0];
        const historyResult = results[1];

        /** @type {WeatherData | null} */
        let latestObs = null;
        /** @type {WeatherData[]} */
        /** @type {RoadStationObservations | null} */
        let latestData = null;
        // Removed duplicate declaration of latestObs here
        /** @type {WeatherData[]} */
        let historicalObs = [];
        /** @type {{gustId?: number, speedId?: number, directionId?: number, tempId?: number, dewPointId?: number}} */
        let sensorIds = {}; // Store sensor IDs from latest data

        // Process latest observation result
        if (
            latestResult.status === "fulfilled" &&
            latestResult.value // Ensure value is not null/undefined
        ) {
            // Assign to outer scope variable for use in history processing
            latestData = latestResult.value;
            debug(`Fetched Digitraffic latest data for ${roadsid}`, latestData);

            // Check if data structure is valid and extract sensor IDs
            if (latestData && latestData.sensorValues && latestData.dataUpdatedTime) {
                const gustSensor = latestData.sensorValues.find(
                    (v) => v.name === "MAKSIMITUULI",
                );
                const windSensor = latestData.sensorValues.find(
                    (v) => v.name === "KESKITUULI",
                );
                const directionSensor = latestData.sensorValues.find(
                    (v) => v.name === "TUULENSUUNTA",
                );
                const tempSensor = latestData.sensorValues.find(
                    (v) => v.name === "ILMA",
                );
                const dewPointSensor = latestData.sensorValues.find(
                    (v) => v.name === "KASTEPISTE",
                );

                // Store sensor IDs for history lookup
                sensorIds = {
                    gustId: gustSensor?.id,
                    speedId: windSensor?.id,
                    directionId: directionSensor?.id,
                    tempId: tempSensor?.id,
                    dewPointId: dewPointSensor?.id,
                };
                debug("Sensor IDs from latest data:", sensorIds);

                /** @type {WeatherData} */
                const obsData = {
                    source: "roads",
                    time: new Date(latestData.dataUpdatedTime), // Use dataUpdatedTime for latest
                    speed: windSensor?.value,
                    gust: gustSensor?.value,
                    direction: directionSensor?.value,
                    temperature: tempSensor?.value,
                    dewPoint: dewPointSensor?.value,
                };

                // Only use the latest observation if it has some valid data
                if (
                    hasValidWindData(obsData) ||
                    obsData.temperature !== undefined ||
                    obsData.dewPoint !== undefined
                ) {
                    latestObs = obsData;
                }
            } else {
                debug(
                    `Invalid structure for latest Digitraffic data for ${roadsid}`,
                    latestData,
                );
            }
        } else if (latestResult.status === "rejected") {
            console.error(
                `Failed to fetch latest Digitraffic data for ${roadsid}:`,
                latestResult.reason,
            );
            // Optionally add error, but history might still succeed
            // addError(`Virhe haettaessa viimeisintä Digitraffic-havaintoa (${roadsid}).`);
        }

        // Process history observation result
        if (
            historyResult.status === "fulfilled" &&
            historyResult.value && // Ensure value is not null/undefined
            historyResult.value.values && // Check for the 'values' array
            Array.isArray(historyResult.value.values)
        ) {
            /** @type {RoadStationHistory} */ // Use the correct type based on orig_data.js
            const historyData = historyResult.value;
            const allHistoryValues = historyData.values;
            debug(
                `Fetched ${allHistoryValues.length} Digitraffic history values for ${roadsid}.`,
            );

            // Filter history values for the gust sensor (if its ID is known)
            const gustHistoryValues = sensorIds.gustId
                ? allHistoryValues.filter((v) => v.id === sensorIds.gustId)
                : [];

            if (gustHistoryValues.length === 0 && sensorIds.gustId) {
                debug(
                    `No history values found for gust sensor ID ${sensorIds.gustId}`,
                );
            }

            // Map through gust history entries to build WeatherData objects
            historicalObs = gustHistoryValues
                .map((gustEntry) => {
                    const measuredTime = gustEntry.measuredTime;
                    // Find all other sensor values with the exact same measuredTime
                    const otherValuesAtTime = allHistoryValues.filter(
                        (v) => v.measuredTime === measuredTime,
                    );

                    // Find specific sensor values by ID within this timestamp group
                    const findValue = (/** @type {number | undefined} */ id) =>
                        id !== undefined
                            ? otherValuesAtTime.find((v) => v.id === id)?.value
                            : undefined;

                    const speedValue = findValue(sensorIds.speedId);
                    const directionValue = findValue(sensorIds.directionId);
                    const tempValue = findValue(sensorIds.tempId);
                    const dewPointValue = findValue(sensorIds.dewPointId);

                    /** @type {WeatherData} */
                    const obsData = {
                        source: "roads",
                        time: new Date(measuredTime),
                        gust: gustEntry.value, // Gust value from the current entry
                        speed: speedValue,
                        direction: directionValue,
                        temperature: tempValue,
                        dewPoint: dewPointValue,
                    };
                    return obsData;
                })
                .filter(
                    /** @type {(obs: WeatherData | null) => obs is WeatherData} */
                    (obs) =>
                        obs !== null && // Filter out potential nulls if mapping failed
                        (hasValidWindData(obs) ||
                            obs.temperature !== undefined ||
                            obs.dewPoint !== undefined),
                ); // Filter out entries with no useful data

            // Sort historical data descending by time (latest first)
            historicalObs.sort((a, b) => b.time.getTime() - a.time.getTime());

            debug(
                `Processed ${historicalObs.length} historical observations from Digitraffic values.`,
            );
        } else if (historyResult.status === "rejected") {
            console.error(
                `Failed to fetch Digitraffic history data for ${roadsid}:`,
                historyResult.reason,
            );
            // Add error only if station info was likely found (implies roadsid was valid)
            if (STATION_NAME.value?.includes("Digitraffic")) {
                addError(
                    `Virhe haettaessa Digitraffic-historiaa (${roadsid}).`,
                );
            }
        } else if (
            historyResult.status === "fulfilled" &&
            (!historyResult.value ||
                !historyResult.value.values || // Check for 'values' array
                !Array.isArray(historyResult.value.values))
        ) {
            // Handle case where history fetch succeeded but returned empty/invalid data structure
            debug(
                `No valid Digitraffic history data structure (missing 'values' array) returned for ${roadsid}`,
                historyResult.value,
            );
            // Optionally add error if station info was found
            if (STATION_NAME.value?.includes("Digitraffic")) {
                addError(
                    `Digitraffic asemalta ${roadsid} ei löytynyt historiatietoja.`,
                );
            }
        }

        // Combine latest observation with historical ones
        let combinedObservations = [...historicalObs];
        if (latestObs) {
            // Add latest observation only if it's newer than the first historical one (or if history is empty)
            if (
                historicalObs.length === 0 ||
                latestObs.time.getTime() > historicalObs[0].time.getTime()
            ) {
                combinedObservations.unshift(latestObs); // Add to the beginning
            } else {
                debug(
                    `Latest observation for ${roadsid} is not newer than history, not prepending.`,
                );
            }
        }

        // Remove potential duplicates just in case (based on time)
        const uniqueObservations = combinedObservations.filter(
            (obs, index, self) =>
                index ===
                self.findIndex((o) => o.time.getTime() === obs.time.getTime()),
        );

        // Apply mocking values if present
        mockAllEntries(uniqueObservations);

        // Update OBSERVATIONS signal
        OBSERVATIONS.value = uniqueObservations;
        debug(
            `Processed ${OBSERVATIONS.value.length} combined Digitraffic observations for ${roadsid}.`,
        );

        // Add error if both fetches failed or resulted in no data
        if (OBSERVATIONS.value.length === 0 && latestResult.status === 'rejected' && historyResult.status === 'rejected') {
             if (STATION_NAME.value?.includes("Digitraffic")) {
                 addError(`Ei havaintotietoja Digitraffic asemalta ${roadsid}. Haku epäonnistui.`);
             }
        } else if (OBSERVATIONS.value.length === 0 && latestResult.status === 'fulfilled' && historyResult.status === 'fulfilled') {
             if (STATION_NAME.value?.includes("Digitraffic")) {
                 addError(`Ei havaintotietoja Digitraffic asemalta ${roadsid}. Asema ei välttämättä raportoi tuulitietoja.`);
             }
        }


    } catch (error) {
        // Catch unexpected errors during Promise.allSettled or processing
        console.error(
            "Unexpected error fetching or processing Digitraffic Observations:",
            error,
        );
        if (STATION_NAME.value?.includes("Digitraffic")) {
            addError(
                `Odottamaton virhe Digitraffic-havaintojen käsittelyssä (${roadsid}): ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        OBSERVATIONS.value = []; // Clear observations on unexpected error
    }
}

/**
 * Fetches all necessary weather data based on current query parameters.
 */
export async function updateWeatherData() {
    debug("updateWeatherData called");
    ERRORS.value = []; // Clear previous errors

    const {
        fmisid,
        roadsid,
        lat,
        lon,
        icaocode,
        name: customName,
    } = QUERY_PARAMS.value;

    let observationPromise = Promise.resolve(); // Default to resolved promise
    let stationInfoSource = null; // Track where station info might come from

    // --- Initiate Observation Fetching ---
    if (fmisid) {
        stationInfoSource = "fmi";
        observationPromise = fetchFmiObservations(fmisid);
    } else if (roadsid) {
        stationInfoSource = "roads";
        // Fetch info and observations concurrently using allSettled
        observationPromise = Promise.allSettled([
            fetchRoadStationInfo(roadsid),
            fetchRoadObservations(roadsid),
        ]).then((results) => {
            // Log if fetches failed, but don't block overall flow
            if (results[0].status === "rejected") {
                debug("Road station info fetch failed:", results[0].reason);
            }
            if (results[1].status === "rejected") {
                debug(
                    "Road station observations fetch failed:",
                    results[1].reason,
                );
            }
            // Let the overall function continue regardless of individual failures here
        });
    } else if (icaocode && !lat && !lon) {
        // Handle case where only ICAO is provided (no station ID or lat/lon)
        stationInfoSource = "metar";
        NAME.value = customName || icaocode || undefined;
        if (NAME.value) localStorage.setItem("previous_dz", NAME.value);

        const obsStartTime = getObservationStartTime();
        const cacheBust = Math.floor(Date.now() / (5 * 60 * 1000));
        if (QUERY_PARAMS.value.flyk_metar) {
            observationPromise = fetchFlykMetar(icaocode); // Fetches METAR only
        } else {
            observationPromise = fetchFmiMetar(
                icaocode,
                obsStartTime,
                cacheBust,
            ); // Fetches METAR only
        }
        // Note: Fetching METAR alone doesn't provide coordinates for forecasts currently.
        // Add a specific message indicating this limitation.
        // We add the error later if forecast coordinates remain unavailable.
        debug(
            "Fetching METAR data based on ICAO code. Forecasts require coordinates.",
        );
    } else if (!lat && !lon) {
        // No station ID, no ICAO, no lat/lon
        addError(
            "Havaintoasemaa (fmisid/roadsid), ICAO-koodia tai koordinaatteja (lat/lon) ei ole määritetty.",
        );
        // Clear all potentially stale data
        OBSERVATIONS.value = [];
        METARS.value = undefined;
        STATION_NAME.value = undefined;
        STATION_COORDINATES.value = null;
        FORECAST_COORDINATES.value = null; // Ensure forecast coords are cleared
        FORECAST_LOCATION_NAME.value = null;
        FORECASTS.value = [];
        return; // Stop here, nothing to fetch
    }
    // If only lat/lon are provided, observationPromise remains Promise.resolve()

    // --- Initiate Forecast & High Winds Fetching (if coords available immediately from URL) ---
    let forecastPromise = Promise.resolve();
    let highWindsPromise = Promise.resolve();
    let forecastsInitiated = false;

    if (lat && lon) {
        const coords = `${lat},${lon}`;
        // Set FORECAST_COORDINATES signal immediately
        FORECAST_COORDINATES.value = coords;
        // Set NAME signal if needed (only if no other identifier was primary)
        if (!NAME.value && !customName && !fmisid && !roadsid && !icaocode) {
            NAME.value = `Koordinaatit ${coords}`;
            if (NAME.value) localStorage.setItem("previous_dz", NAME.value);
        }

        debug(`Initiating forecast fetch using URL parameters: ${coords}`);
        forecastPromise = fetchFmiForecasts(coords);
        highWindsPromise = fetchHighWinds(coords);
        forecastsInitiated = true;
    }

    // --- Wait for Observation Fetching to Settle ---
    // Use try/catch to ensure execution continues even if obsPromise rejects
    try {
        await observationPromise;
        debug("Observation promise settled.");
    } catch (error) {
        // Log the error, but allow the function to proceed to check for coordinates
        console.error("Error awaiting observation promise:", error);
        // Specific errors should have been added by the fetch functions themselves
    }

    // --- Initiate Forecast Fetching (if not already started and coords are now available from station) ---
    // Check if forecasts *haven't* been started AND if we *now* have coordinates
    if (!forecastsInitiated && FORECAST_COORDINATES.value) {
        debug(
            `Initiating forecast fetch using station coordinates: ${FORECAST_COORDINATES.value}`,
        );
        forecastPromise = fetchFmiForecasts(FORECAST_COORDINATES.value);
        highWindsPromise = fetchHighWinds(FORECAST_COORDINATES.value);
        forecastsInitiated = true; // Mark as initiated
    }

    // --- Wait for Forecasts and High Winds (if they were initiated) ---
    if (forecastsInitiated) {
        try {
            // Wait for both forecast and high winds promises to settle
            await Promise.allSettled([forecastPromise, highWindsPromise]);
            debug("Forecast and high winds promises settled.");
        } catch (error) {
            // This catch block might be redundant with allSettled, but good practice
            console.error("Error awaiting forecast/highWinds promises:", error);
        }
    }

    // --- Final Check for Forecast Coordinates ---
    // Add error only if forecasts were never initiated because coordinates were never found
    if (!forecastsInitiated) {
        // Double-check FORECAST_COORDINATES just in case it was set between checks
        if (!FORECAST_COORDINATES.value) {
            // Add a more specific error message depending on what was provided
            if (stationInfoSource === "metar") {
                addError(
                    "Ennusteiden haku epäonnistui: Koordinaatteja ei saatavilla pelkällä ICAO-koodilla. Anna myös lat/lon.",
                );
            } else {
                addError(
                    "Ennusteiden haku epäonnistui: Koordinaatteja ei saatavilla (URL-parametrit, havaintoasema).",
                );
            }
            // Ensure forecasts are cleared if coordinates were never available
            FORECASTS.value = [];
            FORECAST_LOCATION_NAME.value = null;
        } else {
            // This state should ideally not be reachable if the logic above is correct
            console.warn(
                "Forecasts were not initiated despite FORECAST_COORDINATES being available. Review updateWeatherData logic.",
            );
        }
    }

    debug("updateWeatherData finished.");
}

/**
 * Update the query string in the url bar and update the global QUERY_PARAMS signal.
 * @param {QueryParams} params - Parameters to add/update in the query string.
 * @param {object} [options]
 * @param {"merge" | "replace"} [options.mode] - How to apply params: "merge" with existing (default), or "replace" existing.
 * @param {boolean} [options.replace] - Use history.replaceState instead of pushState.
 */
export function navigateQs(params, options) {
    let newQueryParams;

    if (!options?.mode || options.mode === "merge") {
        // Merge new params into existing ones
        newQueryParams = {
            ...QUERY_PARAMS.value,
            ...params,
        };
    } else {
        // Replace existing params with new ones
        newQueryParams = params;
    }

    // Filter out nullish values before creating URLSearchParams
    const cleanQueryParams = removeNullish(newQueryParams);
    const qs = new URLSearchParams(cleanQueryParams);

    const newUrl = `${location.pathname}?${qs}${location.hash}`;

    if (options?.replace) {
        history.replaceState(null, "", newUrl);
    } else {
        history.pushState(null, "", newUrl);
    }

    // Manually update the signal to reflect the new URL state immediately
    // Note: Browsers don't fire popstate for pushState/replaceState, so manual update is needed.
    // Also, this keeps the signal in sync with the browser history state.
    QUERY_PARAMS.value = cleanQueryParams; // Update signal with the *cleaned* params object
}

/**
 * Get query string for for <a href> rendering.
 * @param {QueryParams} [params] - Optional parameters to include/merge.
 * @param {"merge" | "replace"} [mode] - How to apply optional params: "merge" with current (default), or "replace" current.
 * @returns {string} The formatted query string starting with '?'.
 */
export function getQs(params, mode) {
    let query;

    if (!mode || mode === "merge") {
        // Merge optional params into current query params
        query = {
            ...QUERY_PARAMS.value,
            ...params,
        };
    } else {
        // Use only the provided optional params
        query = params;
    }

    // Filter out nullish values
    const cleanQuery = removeNullish(query);

    return "?" + new URLSearchParams(cleanQuery).toString();
}

// Event listeners for visibility changes and pageshow (back/forward cache)
// to refresh data when the tab becomes active again
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        debug("Tab is visible, updating weather data.");
        updateWeatherData();
    }
});

// pageshow is fired when navigating to a page, including from bfcache (back/forward cache)
window.addEventListener("pageshow", (event) => {
    // event.persisted is true if the page was restored from bfcache
    if (event.persisted) {
        debug("Page restored from bfcache, updating weather data.");
        updateWeatherData();
    }
});

// Set interval to automatically update weather data periodically
// Use a variable to hold the interval ID if you might need to clear it
let updateIntervalId = setInterval(updateWeatherData, 5 * 60 * 1000); // Update every 5 minutes (300000 ms)
debug(`Data update interval set to ${5 * 60 * 1000}ms`);

let initial = true; // Flag for the very first load

// Listen to query string changes (via navigateQs or popstate) and refetch the data
QUERY_PARAMS.subscribe((/** @type {QueryParams} */ currentQueryParams) => {
    debug("QUERY_PARAMS changed:", currentQueryParams);
    // Debounce or throttle if needed, but for this use case, reacting immediately is fine.
    // The updateWeatherData function handles loading state.

    updateWeatherData()
        .then(() => {
            // Scroll to URL fragment *after* data is loaded and rendered,
            // but only on the *initial* page load.
            if (initial) {
                initial = false; // Mark initial load as complete

                const fragment = location.hash;
                if (!fragment) {
                    return; // No fragment to scroll to
                }

                let element;
                try {
                    // Find the element by ID corresponding to the fragment
                    element = document.querySelector(fragment);
                } catch (error) {
                    console.warn(`Invalid URL fragment: ${fragment}`, error);
                }

                if (element) {
                    // Use behavior: 'smooth' for smooth scrolling
                    element.scrollIntoView({ behavior: "smooth" });
                    debug(`Scrolled to fragment: ${fragment}`);
                } else {
                    debug(`Element for fragment ${fragment} not found.`);
                }
            }
        })
        .catch((error) => {
            console.error(
                "Error during updateWeatherData on QUERY_PARAMS subscribe:",
                error,
            );
            // Optionally add a general error message
            addError("Tietojen päivityksessä tapahtui virhe.");
        });
});

// Handle browser back/forward navigation (popstate event changes location.search)
window.addEventListener("popstate", () => {
    debug("popstate event fired.");
    // Update the signal to reflect the new URL search params
    QUERY_PARAMS.value = Object.fromEntries(
        new URLSearchParams(location.search),
    );
    // The QUERY_PARAMS subscribe effect will handle fetching data
});

// Constants for WIND_VARIATIONS calculation
// These constants define the thresholds and scoring for the wind risk calculation.
// Adjust these values based on desired sensitivity and tuning.
// --- Konfiguraatio: WindRef-laskennan avainpisteet ---

// Kynnysarvot tuulen nopeudelle (m/s)
const SPEED_THRESHOLDS = {
    LOW: 2.5, // Alle tämän -> hyvin vähäinen riski
    MEDIUM: 4, // Yli tämän -> riski alkaa kasvaa
    HIGH: 6, // Yli tämän -> merkittävä riski
    VERY_HIGH: 8, // Yli tämän -> korkea riski
};

// Kynnysarvot puuskan nopeudelle (m/s)
const GUST_THRESHOLDS = {
    LOW: 3, // Pienet puuskat
    MEDIUM: 5, // Kohtalaiset puuskat
    HIGH: 7, // Kovat puuskat
    VERY_HIGH: 9, // Erittäin kovat puuskat
};

// Kynnysarvot puuskan ja keskituulen erotukselle (m/s)
export const GUST_DIFF_THRESHOLDS = {
    LOW: 2, // Pieni puuskaisuus
    MEDIUM: 3, // Kohtalainen puuskaisuus
    HIGH: 4.5, // Merkittävä puuskaisuus
    VERY_HIGH: 6, // Korkea puuskaisuus
};

// Pisteet riskin laskemiseksi pelkän PUUSKAN perusteella (antaa perusriskin osan)
// score voisi vastata karkeasti vanhaa windRef-tasoa tai olla normalisoitu (0-1)
// Nämä pisteet summataan muiden osien kanssa.
const BASE_RISK_POINTS_GUST = [
    { threshold: 0, score: 0 },
    { threshold: GUST_THRESHOLDS.LOW, score: 0.5 }, // 3 m/s -> 0.5 pistettä
    { threshold: GUST_THRESHOLDS.MEDIUM, score: 1.0 }, // 5 m/s -> 1.0 pistettä
    { threshold: GUST_THRESHOLDS.HIGH, score: 2.0 }, // 7 m/s -> 2.0 pistettä
    { threshold: GUST_THRESHOLDS.VERY_HIGH, score: 3.0 }, // 9 m/s -> 3.0 pistettä
    { threshold: 12, score: 3.5 }, // Lisäpiste interpolaation ylärajaa varten
];

// Pisteet riskin laskemiseksi pelkän KESKITUULEN perusteella (antaa perusriskin toisen osan)
// Nämä pisteet summataan muiden osien kanssa.
const BASE_RISK_POINTS_AVG = [
    { threshold: 0, score: 0 },
    { threshold: SPEED_THRESHOLDS.LOW, score: 0.25 }, // 2.5 m/s -> 0.25 pistettä
    { threshold: SPEED_THRESHOLDS.MEDIUM, score: 0.5 }, // 4 m/s -> 0.5 pistettä
    { threshold: SPEED_THRESHOLDS.HIGH, score: 1.0 }, // 6 m/s -> 1.0 pistettä
    { threshold: SPEED_THRESHOLDS.VERY_HIGH, score: 1.5 }, // 8 m/s -> 1.5 pistettä
    { threshold: 10, score: 1.75 }, // Lisäpiste interpolaation ylärajaa varten
];

// Pisteet PUUSKIEN EROTUKSEN (gust - avg) riskille (normalisoitu 0-1)
// Tämä osa lisätään perusriskiin.
const GUST_DIFF_POINTS = [
    { threshold: 0, score: 0 },
    { threshold: GUST_DIFF_THRESHOLDS.MEDIUM, score: 0.25 }, // 3 m/s erotus -> 0.25 pistettä
    { threshold: GUST_DIFF_THRESHOLDS.HIGH, score: 0.5 }, // 4.5 m/s erotus -> 0.5 pistettä
    { threshold: GUST_DIFF_THRESHOLDS.VERY_HIGH, score: 1.0 }, // 6 m/s erotus -> 1.0 pistettä
    { threshold: 8, score: 1.0 }, // Yläraja
];

// Pisteet SUUNNAN VAIHTELUN perusriskille (normalisoitu 0-1)
// Tämä piste kerrotaan painokertoimella ennen lisäämistä kokonaispisteisiin.
const DIRECTION_VARIATION_BASE_POINTS = [
    { threshold: 0, score: 0 },
    { threshold: 45, score: 0.25 }, // 45 asteen vaihtelu -> 0.25 pistettä
    { threshold: 90, score: 0.5 }, // 90 asteen vaihtelu -> 0.5 pistettä
    { threshold: 180, score: 1.0 }, // 180 asteen vaihtelu -> 1.0 pistettä
    { threshold: 270, score: 1.0 }, // Yläraja
];

// Pisteet SUUNNAN VAIHTELUN PAINOKERTOIMELLE puuskanopeuden mukaan
// Tämä toteuttaa sen, että suunnanvaihtelu on vaarallisempaa kovissa puuskissa.
// Kerroin >= 1.
const DIRECTION_WEIGHT_POINTS_BY_GUST = [
    { threshold: 0, weight: 1.0 }, // 0 m/s puuska -> Paino 1.0 (peruspaino)
    { threshold: GUST_THRESHOLDS.LOW, weight: 1.0 }, // 3 m/s -> Paino 1.0
    { threshold: GUST_THRESHOLDS.MEDIUM, weight: 1.5 }, // 5 m/s -> Paino 1.5
    { threshold: GUST_THRESHOLDS.HIGH, weight: 2.0 }, // 7 m/s -> Paino 2.0
    { threshold: GUST_THRESHOLDS.VERY_HIGH, weight: 3.0 }, // 9 m/s -> Paino 3.0
    { threshold: 12, weight: 3.0 }, // Yläraja
];

// Kynnysarvot lopullisen kokonaisriskipisteen muuntamiseksi windRef 0-4
// Nämä määrittävät, millä pistemäärällä siirrytään seuraavaan windRef-tasoon.
// Säädä näitä herkkyyden mukaan.
const FINAL_SCORE_TO_WINDREF_THRESHOLDS = [
    { score: -Infinity, windRef: 0 }, // Alle 0 pisteen -> windRef 0 (teoriassa)
    { score: 1.0, windRef: 1 }, // Pisteet >= 1.0 -> windRef 1
    { score: 2.5, windRef: 2 }, // Pisteet >= 2.5 -> windRef 2
    { score: 4.5, windRef: 3 }, // Pisteet >= 4.5 -> windRef 3
    { score: 6.5, windRef: 4 }, // Pisteet >= 6.5 -> windRef 4
];
// --- Konfiguraation loppu ---

// Helper functions for WIND_VARIATIONS calculation and data processing

/**
 * Lineaarisesti interpoloi arvon annettujen pisteiden perusteella.
 * Rajoittaa tuloksen pisteiden määrittelemään minimi- ja maksimiarvoon.
 * @template T - Type of the property to interpolate (score or weight).
 * @param {number} value - Arvo, jolle interpolaatio tehdään.
 * @param {Array<{threshold: number, [key: string]: number}>} points - Järjestetty taulukko pisteitä ({threshold, score} tai {threshold, weight}).
 * @param {string} key - The property name ('score' or 'weight') to interpolate.
 * @returns {number} Interpoloitu arvo (score tai weight).
 */
function interpolateValue(value, points, key) {
    if (!points || points.length === 0) {
        console.error(
            `interpolateValue: Points array is empty or undefined for key "${key}".`,
        );
        return 0; // Return a default value like 0 or throw error
    }
    // Ensure points are sorted by threshold
    // points.sort((a, b) => a.threshold - b.threshold); // Uncomment if not sure about sort order

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];

    // Ensure firstPoint and lastPoint exist before accessing properties
    if (!firstPoint || !lastPoint) {
        console.error(
            `interpolateValue: Invalid points array for key "${key}".`,
        );
        return 0;
    }

    // If value is less than or equal to the first threshold
    if (value <= firstPoint.threshold) {
        return firstPoint[key] ?? 0; // Add default value
    }

    // If value is greater than or equal to the last threshold
    if (value >= lastPoint.threshold) {
        return lastPoint[key] ?? 0; // Add default value
    }

    // Find the interval [p1, p2] where p1.threshold <= value <= p2.threshold
    for (let i = 1; i < points.length; i++) {
        const p1 = points[i - 1];
        const p2 = points[i];

        // Ensure p1 and p2 exist (should always be true inside the loop bounds)
        if (!p1 || !p2) continue;

        if (value >= p1.threshold && value <= p2.threshold) {
            // Handle case where thresholds are the same to avoid division by zero
            if (p2.threshold === p1.threshold) {
                return p1[key] ?? 0; // Add default value
            }
            // Linear interpolation formula
            const t = (value - p1.threshold) / (p2.threshold - p1.threshold); // Proportion along the threshold axis (0 to 1)
            // Ensure p1[key] and p2[key] are numbers before arithmetic
            const val1 = typeof p1[key] === "number" ? p1[key] : 0;
            const val2 = typeof p2[key] === "number" ? p2[key] : 0;
            const interpolated = val1 + t * (val2 - val1); // Interpolate the score/weight
            return interpolated;
        }
    }

    // Fallback if value is somehow outside all defined intervals (shouldn't happen with the above checks)
    console.warn(
        `interpolateValue: Value ${value} is outside defined thresholds for key "${key}". Using last point.`,
    );
    // Ensure lastPoint exists before accessing property
    return lastPoint ? (lastPoint[key] ?? 0) : 0; // Add default value
}

/**
 * Calculates a continuous risk score and a discrete windRef level (0-4) based on wind parameters.
 * This uses interpolation and weighted summing of different risk factors.
 * @param {number} averageSpeed - The average wind speed in m/s.
 * @param {number} maxGust - The maximum wind gust in m/s.
 * @param {number} variationRange - The range of wind direction variation in degrees (0-180).
 * @returns {{finalScore: number, windRef: number, details: object}} Object containing the final score, windRef level, and intermediate scores for debugging.
 */
function calculateRefinedWindRisk(averageSpeed, maxGust, variationRange) {
    // Ensure inputs are valid numbers, default to 0 or a safe minimum if not
    averageSpeed =
        typeof averageSpeed === "number" && !isNaN(averageSpeed)
            ? Math.max(0, averageSpeed)
            : 0;
    maxGust =
        typeof maxGust === "number" && !isNaN(maxGust)
            ? Math.max(0, maxGust)
            : 0;
    variationRange =
        typeof variationRange === "number" && !isNaN(variationRange)
            ? Math.max(0, Math.min(180, variationRange))
            : 0; // Cap variation range at 180

    // 1. Calculate base risk scores from average speed and max gust separately
    const baseGustScore = interpolateValue(
        maxGust,
        BASE_RISK_POINTS_GUST,
        "score",
    );
    const baseAvgScore = interpolateValue(
        averageSpeed,
        BASE_RISK_POINTS_AVG,
        "score",
    );

    // Combine base scores. Summing is a reasonable approach.
    let baseScore = baseGustScore + baseAvgScore;

    // Optional: Add a minimum base score for very light winds if needed, e.g., to ensure windRef is at least 1
    // This is handled by the first threshold in FINAL_SCORE_TO_WINDREF_THRESHOLDS >= 1.0
    if (
        averageSpeed <= SPEED_THRESHOLDS.LOW &&
        maxGust <= GUST_THRESHOLDS.LOW
    ) {
        // Maybe slightly increase base score if winds are present but very low, to differentiate from 0
        // The thresholds are designed to give >0 score already, so this might not be needed.
    }

    // 2. Calculate risk score based on gust difference (gust - average speed)
    const gustDiff = Math.max(0, maxGust - averageSpeed); // Ensure difference is not negative
    const gustDiffScore = interpolateValue(gustDiff, GUST_DIFF_POINTS, "score"); // Score between 0 and 1

    // 3. Calculate direction variation risk, weighted by gust speed
    const directionVariationBaseScore = interpolateValue(
        variationRange,
        DIRECTION_VARIATION_BASE_POINTS,
        "score",
    ); // Base score between 0 and 1
    const directionWeight = interpolateValue(
        maxGust,
        DIRECTION_WEIGHT_POINTS_BY_GUST,
        "weight",
    ); // Weight >= 1

    // Apply weight to the direction variation score
    const directionVariationWeightedScore =
        directionVariationBaseScore * directionWeight;

    // 4. Combine all risk components into a final score
    // Summing the components: Base Risk + Gustiness Risk + Weighted Direction Risk
    const finalScore =
        baseScore + gustDiffScore + directionVariationWeightedScore;

    // 5. Convert the final continuous score into a discrete windRef level (0-4)
    let finalWindRef = 0;
    // Iterate through the thresholds from lowest score to highest
    for (const thresholdPoint of FINAL_SCORE_TO_WINDREF_THRESHOLDS) {
        if (finalScore >= thresholdPoint.score) {
            finalWindRef = thresholdPoint.windRef;
        } else {
            // Since thresholds are sorted, if score is below current threshold,
            // the previous windRef is the correct one. Break the loop.
            break;
        }
    }

    // Ensure finalWindRef is within the valid range (0-4)
    finalWindRef = Math.min(Math.max(finalWindRef, 0), 4);

    // Return results and intermediate details for analysis/tuning
    return {
        finalScore: finalScore,
        windRef: finalWindRef,
        details: {
            averageSpeed,
            maxGust,
            variationRange,
            baseScore,
            baseGustScore,
            baseAvgScore,
            gustDiff,
            gustDiffScore,
            directionVariationBaseScore,
            directionWeight,
            directionVariationWeightedScore,
            // Add other values if needed
        },
    };
}

/**
 * Calculates the average direction from an array of degree values.
 * Handles the circular nature of directions (e.g., average of 350 and 10 is 0).
 * @param {number[]} directions - Array of wind directions in degrees (0-360).
 * @returns {number} The average direction in degrees (0-360). Returns NaN if input array is empty.
 */
function calculateAverageDirection(directions) {
    debug(`calculateAverageDirection: directions = [${directions.join(", ")}]`);
    if (!directions || directions.length === 0) {
        debug("calculateAverageDirection: Input array is empty.");
        return NaN; // Cannot calculate average of empty array
    }

    const sumSin = directions.reduce(
        (/** @type {number} */ sum, /** @type {number} */ dir) =>
            sum + Math.sin((dir * Math.PI) / 180),
        0,
    );
    const sumCos = directions.reduce(
        (/** @type {number} */ sum, /** @type {number} */ dir) =>
            sum + Math.cos((dir * Math.PI) / 180),
        0,
    );

    // If sumSin and sumCos are both close to zero (e.g., directions are opposite or random),
    // atan2 result is undefined. Handle this case.
    if (Math.abs(sumSin) < 1e-6 && Math.abs(sumCos) < 1e-6) {
        debug(
            "calculateAverageDirection: Sum of sines and cosines near zero, returning NaN.",
        );
        return NaN; // Indicate no clear average direction
    }

    const averageRadians = Math.atan2(sumSin, sumCos);
    const averageDegrees = (averageRadians * 180) / Math.PI;

    // Convert to a 0-360 range
    const result = (averageDegrees + 360) % 360;
    debug(`calculateAverageDirection: result = ${result}`);
    return result;
}

/**
 * Calculates the maximum range of variation within an array of directions.
 * Accounts for the circular nature of directions.
 * @param {number[]} directions - Array of wind directions in degrees (0-360).
 * @returns {number} The maximum variation range in degrees (0-180). Returns 0 if input array has 0 or 1 element.
 */
export function calculateVariationRange(directions) {
    debug(`calculateVariationRange: directions = [${directions.join(", ")}]`);
    if (!directions || directions.length <= 1) {
        debug(
            "calculateVariationRange: Input array has 0 or 1 element, variation is 0.",
        );
        return 0;
    }

    let maxDiff = 0;
    // Compare each direction with every other direction
    for (let i = 0; i < directions.length; i++) {
        for (let j = i + 1; j < directions.length; j++) {
            const dir1 = directions[i] ?? 0; // Default to 0 if null/undefined (should be filtered?)
            const dir2 = directions[j] ?? 0;

            // Calculate difference considering the 360-degree wrap-around
            const diff = Math.abs(dir1 - dir2);
            const adjustedDiff = Math.min(diff, 360 - diff); // Shortest angle difference (max 180)

            maxDiff = Math.max(maxDiff, adjustedDiff);
        }
    }
    debug(`calculateVariationRange: result = ${maxDiff}`);
    return maxDiff; // Max variation is capped at 180 degrees
}

/**
 * Filters an array of observations to include only those within the last 30 minutes.
 * Optionally ignores the time filter for debugging.
 * @param {WeatherData[]} observations - Array of WeatherData objects.
 * @returns {WeatherData[]} Filtered array.
 */
const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;

/**
 * @param {WeatherData[]} observations
 * @returns {WeatherData[]}
 */
function filterRecentObservations(observations) {
    // If debug mode is enabled, return all observations for variation calculation
    // This helps see the effect of mocking or limited data.
    if (QUERY_PARAMS.value.debug) {
        debug(
            "filterRecentObservations: Debug mode active, returning all observations.",
        );
        return observations;
    }
    debug(
        "filterRecentObservations: Filtering observations from the last 30 minutes.",
    );
    const thirtyMinutesAgo = Date.now() - THIRTY_MINUTES_IN_MS; // THIRTY_MINUTES_IN_MS is 30*60*1000

    // Filter observations by time
    const recent = observations.filter(
        (/** @type {WeatherData} */ obs) =>
            obs.time.getTime() >= thirtyMinutesAgo,
    );
    debug(
        `filterRecentObservations: Found ${recent.length} recent observations.`,
    );
    return recent;
}

/**
 * Extracts and filters relevant wind data (directions, speeds, gusts) from WeatherData objects.
 * Removes null, undefined, and NaN values.
 * @param {WeatherData[]} observations - Array of WeatherData objects.
 * @returns {{directions: number[], speeds: number[], gusts: number[]}} Object containing arrays of valid numbers.
 */
function extractAndFilterData(observations) {
    // Filter out null/undefined and invalid number values for wind data
    const directions = observations
        .map((obs) => obs.direction)
        .filter(
            /** @type {(dir: number | undefined) => dir is number} */
            (dir) =>
                typeof dir === "number" &&
                !isNaN(dir) &&
                dir >= 0 &&
                dir <= 360,
        );
    const speeds = observations
        .map((obs) => obs.speed)
        .filter(
            /** @type {(speed: number | undefined) => speed is number} */
            (speed) => typeof speed === "number" && !isNaN(speed) && speed >= 0,
        );
    const gusts = observations
        .map((obs) => obs.gust)
        .filter(
            /** @type {(gust: number | undefined) => gust is number} */
            (gust) => typeof gust === "number" && !isNaN(gust) && gust >= 0,
        );

    debug(
        `extractAndFilterData: directions=${directions.length}, speeds=${speeds.length}, gusts=${gusts.length}`,
    );

    return { directions, speeds, gusts };
}

/**
 * Calculates core wind parameters (average direction, variation, average speed, max gust)
 * from filtered wind data arrays.
 * @param {number[]} directions - Filtered array of wind directions.
 * @param {number[]} speeds - Filtered array of wind speeds.
 * @param {number[]} gusts - Filtered array of wind gusts.
 * @returns {{averageDirection: number, variationRange: number, averageSpeed: number, maxGust: number}} Calculated wind parameters. Returns NaN for averages/max if input array is empty.
 */
function calculateWindData(directions, speeds, gusts) {
    const averageDirection = calculateAverageDirection(directions);
    const variationRange = calculateVariationRange(directions);

    const averageSpeed =
        speeds.length > 0
            ? speeds.reduce(
                  (/** @type {number} */ sum, /** @type {number} */ speed) =>
                      sum + speed,
                  0,
              ) / speeds.length
            : 0; // Default average speed to 0 if no data
    const maxGust = gusts.length > 0 ? Math.max(...gusts) : 0; // Default max gust to 0 if no data

    debug(
        `calculateWindData: avgDir=${averageDirection}, varRange=${variationRange}, avgSpeed=${averageSpeed}, maxGust=${maxGust}`,
    );

    return { averageDirection, variationRange, averageSpeed, maxGust };
}

/**
 * Calculates an "extra width" value based on the difference between max gust and average speed.
 * Used potentially for visualization thickness.
 * @param {number} maxGust - Maximum wind gust in m/s.
 * @param {number} averageSpeed - Average wind speed in m/s.
 * @returns {number} The calculated extra width (clamped between 0 and MAX_EXTRA_WIDTH).
 */
// Constants for extra width calculation
const MAX_EXTRA_WIDTH = 30; // Maximum extra width value
const EXTRA_WIDTH_MULTIPLIER = 3; // How much the gust difference affects width

/**
 * @param {number} maxGust
 * @param {number} averageSpeed
 * @returns {number}
 */
function calculateExtraWidth(maxGust, averageSpeed) {
    // Ensure inputs are numbers, default to 0 if not
    maxGust = typeof maxGust === "number" && !isNaN(maxGust) ? maxGust : 0;
    averageSpeed =
        typeof averageSpeed === "number" && !isNaN(averageSpeed)
            ? averageSpeed
            : 0;

    // Calculate the difference, ensure it's not negative
    const diff = Math.max(0, maxGust - averageSpeed);
    // Apply multiplier and clamp the result
    const extraWidth = Math.min(
        Math.max(Math.round(diff * EXTRA_WIDTH_MULTIPLIER), 0),
        MAX_EXTRA_WIDTH,
    );
    debug(
        `calculateExtraWidth: maxGust=${maxGust}, avgSpeed=${averageSpeed}, diff=${diff}, result=${extraWidth}`,
    );
    return extraWidth;
}

/**
 * Computed signal that calculates wind variation and risk (windRef) based on recent observations.
 * Depends on OBSERVATIONS signal.
 * @returns {{variationRange: number, averageDirection: number, windRef: number, color: string, extraWidth: number, averageSpeed: number, maxGust: number, finalScore: number, calculationDetails: object}|undefined}
 * Returns an object with wind parameters and risk level, or undefined if insufficient data.
 */
export const WIND_VARIATIONS = computed(() => {
    debug("WIND_VARIATIONS: Calculating...");

    // Use mock data if specified in query params for debugging variations
    const mockMode = QUERY_PARAMS.value.mock === "wind-variations";

    // Define DEBUG constants if they don't exist
    const DEBUG_DIRECTIONS =
        QUERY_PARAMS.value.__directions
            ?.split(",")
            .map(Number)
            .filter((/** @type {number} */ n) => !isNaN(n)) ?? [];
    const DEBUG_SPEEDS =
        QUERY_PARAMS.value.__speeds
            ?.split(",")
            .map(Number)
            .filter((/** @type {number} */ n) => !isNaN(n)) ?? [];
    const DEBUG_GUSTS =
        QUERY_PARAMS.value.__gusts
            ?.split(",")
            .map(Number)
            .filter((/** @type {number} */ n) => !isNaN(n)) ?? [];

    /** @type {WeatherData[]} */
    const observations =
        mockMode &&
        DEBUG_DIRECTIONS.length > 0 &&
        DEBUG_SPEEDS.length > 0 &&
        DEBUG_GUSTS.length > 0
            ? DEBUG_DIRECTIONS.map(
                  (/** @type {number} */ dir, /** @type {number} */ idx) => ({
                      source: "mock",
                      direction: dir,
                      speed: DEBUG_SPEEDS[idx % DEBUG_SPEEDS.length],
                      gust: DEBUG_GUSTS[idx % DEBUG_GUSTS.length],
                      time: new Date(
                          Date.now() -
                              (DEBUG_DIRECTIONS.length - 1 - idx) * 60 * 1000,
                      ), // Distribute mock times over last few minutes
                  }),
              )
            : OBSERVATIONS.value; // Use real observations otherwise

    debug(
        "WIND_VARIATIONS: observations source:",
        mockMode ? "mock" : "real",
        observations,
    );

    const recentObservations = filterRecentObservations(observations);

    // Need at least two data points with direction and speed/gust to calculate variation/gust diff reliably
    const { directions, speeds, gusts } =
        extractAndFilterData(recentObservations);

    // Minimum data points needed for calculation. Variation range needs at least 2 directions.
    // Gust/speed diff needs at least one gust and one speed.
    // Let's require at least 2 observations with wind data for meaningful calculation.
    const observationsWithWind = recentObservations.filter(hasValidWindData);

    if (
        observationsWithWind.length < 2 ||
        directions.length < 2 ||
        speeds.length === 0 ||
        gusts.length === 0
    ) {
        debug(
            `WIND_VARIATIONS: Insufficient data. Needed >=2 wind obs, >=2 directions, >=1 speed, >=1 gust. Got: wind obs=${observationsWithWind.length}, directions=${directions.length}, speeds=${speeds.length}, gusts=${gusts.length}`,
        );
        return undefined; // Not enough data points with valid wind to calculate variation/risk
    }

    const { averageDirection, variationRange, averageSpeed, maxGust } =
        calculateWindData(directions, speeds, gusts);

    // Handle potential NaN from calculateWindData if inputs were weird, although extractAndFilterData should prevent this.
    if (
        isNaN(averageDirection) ||
        isNaN(variationRange) ||
        isNaN(averageSpeed) ||
        isNaN(maxGust)
    ) {
        console.error(
            "WIND_VARIATIONS: Calculation resulted in NaN values for core wind data.",
            { averageDirection, variationRange, averageSpeed, maxGust },
        );
        return undefined;
    }

    // Calculate the refined wind risk score and level
    const { finalScore, windRef, details } = calculateRefinedWindRisk(
        averageSpeed,
        maxGust,
        variationRange,
    );
    debug("Refined Wind Risk Calculation Details:", details);

    // Check if the calculated windRef is valid (should be 0-4 based on thresholds)
    if (windRef === undefined || windRef < 0 || windRef > 4) {
        console.error(
            "WIND_VARIATIONS: Invalid wind reference value calculated",
            windRef,
            details,
        );
        return undefined; // Return undefined if the result is unexpected
    }

    // Map windRef level (0-4) to a color
    // COLOR_MAPPINGS: { 0: green/yellowish, 1: green, 2: orange, 3: red, 4: dark red/maroon - depends on actual mapping }
    // Let's use a different mapping that aligns better with windRef levels
    const windRefColors = ["#E6DB00", "#2CF000", "orange", "red", "darkred"]; // 0, 1, 2, 3, 4
    const color = windRefColors[windRef] ?? "grey"; // Default to grey if windRef is somehow out of range

    const result = {
        variationRange, // Max variation in degrees
        averageDirection, // Average direction in degrees
        windRef, // Calculated windRef level (0-4)
        color, // Color string based on windRef
        extraWidth: calculateExtraWidth(maxGust, averageSpeed), // Thickness indicator
        averageSpeed, // Average speed (m/s)
        maxGust, // Max gust (m/s)
        finalScore, // The continuous risk score
        calculationDetails: details, // Details of the calculation steps
    };

    debug("WIND_VARIATIONS: result = ", result);
    return result;
});

// Handle custom events dispatched by fetchJSON on error
document.addEventListener(
    "fetchjsonerror",
    (/** @type {Event | CustomEvent} */ event) => {
        // Check if the event is a CustomEvent and has a message in detail
        if (
            event instanceof CustomEvent &&
            event.detail &&
            typeof event.detail.message === "string"
        ) {
            addError(`Verkkohaku epäonnistui: ${event.detail.message}`);
        } else {
            // Fallback error message if event detail is unexpected
            addError("Verkkohaku epäonnistui tuntemattomasta syystä.");
            console.error(
                "Received fetchjsonerror with unexpected detail:",
                // @ts-ignore - Accessing detail on potentially generic Event if not CustomEvent
                event.detail,
            );
        }
    },
);
