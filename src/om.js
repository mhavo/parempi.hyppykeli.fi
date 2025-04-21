// @ts-check
import { html } from "htm/preact";
import {
    FORECAST_COORDINATES,
    STATION_COORDINATES,
    addError,
} from "./data.js";
import { signal } from "@preact/signals";
import { isNullish } from "./utils.js";

// --- Constants ---

const OM_API_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const OM_CACHE_KEY_DATA = "OMWindAloftData"; // Renamed for clarity
const OM_CACHE_KEY_TIME = "OMWindAloftTime";
const OM_CACHE_KEY_COORDS = "OMWindAloftCoords";
const OM_CACHE_EXPIRY_MS = 3600 * 1000; // 1 hour

// Pressure levels for display (UI)
const PRESSURE_LEVELS_DISPLAY = [
    { pressure: "600 hPa", height: "4200" },
    { pressure: "700 hPa", height: "3000" },
    { pressure: "850 hPa", height: "1500" },
    { pressure: "925 hPa", height: "800" },
    { pressure: "1000 hPa", height: "110" },
];

// Pressure levels for API request and internal data mapping
/**
 * @type {Array<{ pressure: string, height: string, speedKey: keyof OpenMeteoHourlyData, directionKey: keyof OpenMeteoHourlyData }>}
 */
const PRESSURE_LEVELS_API_MAP = [
    {
        pressure: "600 hPa",
        height: "4200", // Added height for consistency if needed later
        speedKey: "windspeed_600hPa",
        directionKey: "winddirection_600hPa",
    },
    {
        pressure: "700 hPa",
        height: "3000",
        speedKey: "windspeed_700hPa",
        directionKey: "winddirection_700hPa",
    },
    {
        pressure: "850 hPa",
        height: "1500",
        speedKey: "windspeed_850hPa",
        directionKey: "winddirection_850hPa",
    },
    {
        pressure: "925 hPa",
        height: "800",
        speedKey: "windspeed_925hPa",
        directionKey: "winddirection_925hPa",
    },
    {
        pressure: "1000 hPa",
        height: "110",
        speedKey: "windspeed_1000hPa",
        directionKey: "winddirection_1000hPa",
    },
];

// Generate the hourly parameters string dynamically
const HOURLY_PARAMS = PRESSURE_LEVELS_API_MAP.map(
    // Explicitly convert symbol keys to strings
    (p) => `${String(p.speedKey)},${String(p.directionKey)}`,
).join(",");

// Time slots for the display table (hours UTC)
const TIME_SLOTS = [0, 3, 6, 9, 12, 15, 18, 21];

const WIND_SPEED_CLASSES = [
    "wind-low",
    "wind-medium",
    "wind-high",
    "wind-very-high",
];

const ON_CANOPY_HEIGHTS = ["110", "800"];
const FREE_FALL_HEIGHTS = ["1500", "3000", "4200"];

/**
 * @type {import("@preact/signals").Signal<OpenMeteoWeatherData | null>}
 */
const OM_DATA = signal(null);

// --- Utility Functions ---

/**
 * Gets the start and end date strings ("YYYY-MM-DD") for the API request,
 * covering today and tomorrow.
 * @returns {{start_date: string, end_date: string}}
 */
function getTimeRange() {
    const now = new Date();
    // Assert non-null with ! as split should always return at least one element
    // Use optional chaining and provide a fallback empty string
    const start_date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        .toISOString()
        .split("T")?.[0] ?? ""; // Start from the beginning of today
    const end_date = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // Include tomorrow
    )
        .toISOString()
        .split("T")?.[0] ?? ""; // End at the beginning of the day after tomorrow (API includes end_date)
    return { start_date, end_date };
}

/**
 * Validates the structure of the raw OpenMeteo data.
 * Checks if essential parts like hourly time array exist and are not empty.
 * @param {any} data The data to validate.
 * @returns {data is OpenMeteoWeatherData} True if the data structure looks valid.
 */
function isValidOpenMeteoData(data) {
    if (
        !data ||
        typeof data !== "object" ||
        !data.hourly ||
        typeof data.hourly !== "object" ||
        !Array.isArray(data.hourly.time) ||
        data.hourly.time.length === 0
    ) {
        console.error("Invalid or incomplete OpenMeteo data structure:", data);
        return false;
    }
    // Could add more checks here if needed (e.g., presence of specific keys)
    return true;
}

// --- Data Fetching and Caching ---

/**
 * Fetches wind data from the Open-Meteo API for the given coordinates.
 * Handles network errors and basic response validation.
 * @param {string} coordinates Latitude,Longitude string.
 * @returns {Promise<OpenMeteoWeatherData | null>} The raw API response data or null on error/invalid data.
 */
async function fetchOpenMeteoData(coordinates) {
    const { start_date, end_date } = getTimeRange();
    const [latitudeStr, longitudeStr] = coordinates.split(",");
    const latitude = Number(latitudeStr);
    const longitude = Number(longitudeStr);

    if (isNaN(latitude) || isNaN(longitude)) {
        console.error("Invalid coordinates provided:", coordinates);
        addError(`Virheelliset koordinaatit: ${coordinates}`);
        return null;
    }

    const url = `${OM_API_BASE_URL}?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${HOURLY_PARAMS}&start_date=${start_date}&end_date=${end_date}`;
    console.log("Fetching OpenMeteo data from:", url);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(
                `Error fetching OpenMeteo data: ${response.status} ${response.statusText}`,
            );
            try {
                // Try to get more details from the response body
                const errorBody = await response.text();
                console.error("API Error details:", errorBody);
                addError(
                    `Ylätuulien haussa tapahtui virhe (${response.status}).`,
                );
            } catch (e) {
                // Ignore error reading body, primary error is the status code
                addError(
                    `Ylätuulien haussa tapahtui virhe (${response.status}).`,
                );
            }
            return null;
        }

        const data = await response.json();

        // Basic validation of the received data structure
        if (!isValidOpenMeteoData(data)) {
            addError("OpenMeteo API:sta saatu data oli puutteellista.");
            return null; // Don't proceed with invalid data
        }

        console.log("Received valid OpenMeteo data.");
        return data;
    } catch (error) {
        console.error("Network error fetching OpenMeteo data:", error);
        addError("Ylätuulien haku epäonnistui verkkoyhteysvirheen vuoksi.");
        return null;
    }
}

// --- Removed old fetchDataWithCoordinates ---

export function clearOMCache() {
    // Use the new constants
    localStorage.removeItem(OM_CACHE_KEY_DATA);
    localStorage.removeItem(OM_CACHE_KEY_TIME);
    localStorage.removeItem(OM_CACHE_KEY_COORDS);
    console.log("OpenMeteo wind cache cleared.");
}

/**
 * Fetches high wind forecast data (OpenMeteo), utilizing localStorage cache.
 * Orchestrates fetching, caching, and updating the OM_DATA signal.
 * @param {string} coordinates Latitude,Longitude string.
 */
export async function fetchHighWinds(coordinates) {
    const cachedDataStr = localStorage.getItem(OM_CACHE_KEY_DATA);
    const cachedTimeStr = localStorage.getItem(OM_CACHE_KEY_TIME);
    const cachedCoords = localStorage.getItem(OM_CACHE_KEY_COORDS);

    const now = Date.now();

    if (cachedDataStr && cachedTimeStr && cachedCoords === coordinates) {
        const cacheTime = Number(cachedTimeStr);
        const cacheAge = now - cacheTime;

        if (!isNaN(cacheTime) && cacheAge < OM_CACHE_EXPIRY_MS) {
            console.log(
                `Using cached OpenMeteo data (age: ${Math.round(cacheAge / 60000)} min).`,
            );
            try {
                const parsedData = JSON.parse(cachedDataStr);
                // Validate cached data structure as well
                if (isValidOpenMeteoData(parsedData)) {
                    OM_DATA.value = parsedData;
                    return; // Use cached data
                } else {
                    console.warn(
                        "Cached OpenMeteo data is invalid, clearing cache.",
                    );
                    clearOMCache(); // Clear invalid cache entry
                    // Proceed to fetch new data
                }
            } catch (error) {
                console.error(
                    "Error parsing cached OpenMeteo data, clearing cache:",
                    error,
                );
                clearOMCache(); // Clear corrupted cache entry
                // Proceed to fetch new data
            }
        } else {
            console.log("Cached OpenMeteo data expired or timestamp invalid.");
            // Proceed to fetch new data
        }
    } else {
        if (cachedCoords !== coordinates)
            console.log("Coordinates changed, fetching new OpenMeteo data.");
        else console.log("No valid cache entry found for OpenMeteo data.");
        // Proceed to fetch new data
    }

    console.log("Fetching new OpenMeteo data from API...");
    const newData = await fetchOpenMeteoData(coordinates);

    if (newData) {
        // newData is already validated by fetchOpenMeteoData
        try {
            localStorage.setItem(OM_CACHE_KEY_DATA, JSON.stringify(newData));
            localStorage.setItem(OM_CACHE_KEY_TIME, now.toString());
            localStorage.setItem(OM_CACHE_KEY_COORDS, coordinates);
            console.log("New OpenMeteo data cached.");
        } catch (error) {
            console.error(
                "Error saving OpenMeteo data to localStorage:",
                error,
            );
            // Attempt to clear cache if saving failed (likely quota exceeded)
            clearOMCache();
            addError(
                "Ylätuuliennusteen tallennus välimuistiin epäonnistui. Selainmuisti saattaa olla täynnä.",
            );
            // Still update the signal with the fetched data, even if caching failed
        }
        OM_DATA.value = newData;
    } else {
        // Fetch failed, ensure data signal reflects failure (might already be null)
        // If there was old (but expired/invalid) data, clear it.
        if (OM_DATA.value !== null) {
             OM_DATA.value = null;
        }
        // Error message already added by fetchOpenMeteoData
        console.error("Failed to fetch new OpenMeteo data.");
    }
}

// --- Formatting and UI Components ---
// (Keep formatTableData and UI components as they rely on OM_DATA signal)

/**
 * Formats the raw hourly data from OpenMeteo into data structured for the display tables (today/tomorrow with 3-hour averages).
 * @param {OpenMeteoHourlyData} hourly The `hourly` object from the validated API response.
 * @returns {{ pressureLevels: typeof PRESSURE_LEVELS_DISPLAY, todayData: OpenMeteoDayData, tomorrowData: OpenMeteoDayData }}
 */
function formatTableData(hourly) {
    /** @type {OpenMeteoDayData} */
    const todayData = {};

    /** @type {OpenMeteoDayData} */
    const tomorrowData = {};

    // Ensure we use the correct pressure level mapping for keys
    const pressureLevelKeys = PRESSURE_LEVELS_API_MAP.map(level => ({
        // Use optional chaining and provide a fallback empty string
        pressureNum: level.pressure.split(" ")?.[0] ?? "", // "600"
        speedKey: level.speedKey,
        directionKey: level.directionKey,
    }));

    TIME_SLOTS.forEach((slot) => {
        todayData[slot] = getAverageData(hourly, slot, 0, pressureLevelKeys);
        tomorrowData[slot] = getAverageData(hourly, slot, 1, pressureLevelKeys);
    });

    // Use PRESSURE_LEVELS_DISPLAY for the table structure
    return { pressureLevels: PRESSURE_LEVELS_DISPLAY, todayData, tomorrowData };
}

/**
 * Calculates average wind data for a specific 3-hour time slot on a given day offset.
 * Uses the current hour's data if it falls within the target slot for today.
 * @param {OpenMeteoHourlyData} hourly Raw hourly data.
 * @param {number} targetHour The starting hour of the 3-hour block (0, 3, 6...).
 * @param {number} dayOffset 0 for today, 1 for tomorrow.
 * @param {Array<{pressureNum: string, speedKey: keyof OpenMeteoHourlyData, directionKey: keyof OpenMeteoHourlyData}>} pressureLevelKeys Mapping of pressure levels to API keys.
 * @returns {{ data: AverageWindSpeeds, isCurrentBlock: boolean }}
 */
function getAverageData(hourly, targetHour, dayOffset, pressureLevelKeys) {
    const now = new Date();
    const currentHour = now.getHours();
    // Check if the *current* actual hour falls into this target 3-hour block *today*
    const isCurrentBlock =
        dayOffset === 0 &&
        currentHour >= targetHour &&
        currentHour < targetHour + 3;

    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + dayOffset);
    targetDate.setHours(0, 0, 0, 0); // Start of the target day

    /** @type {AverageWindSpeeds} */
    const result = {};

    // Find the index for the *current* hour if this is the current block
    let currentHourIndex = -1;
    if (isCurrentBlock) {
        const currentHourISOStart = now.toISOString().substring(0, 13); // "YYYY-MM-DDTHH"
        currentHourIndex = hourly.time.findIndex((/** @type {string} */ time) =>
            time.startsWith(currentHourISOStart),
        );
        if (currentHourIndex === -1) {
             console.warn(`Could not find data for current hour (${currentHourISOStart}) in hourly data.`);
        }
    }

    // Find indices for the 3 hours within the target block
    const relevantIndices = [0, 1, 2]
        .map((hourOffset) => {
            const hourInBlock = targetHour + hourOffset;
            // Construct ISO string start for the target hour on the target date
            const targetHourISOStart = `${targetDate.toISOString().substring(0, 10)}T${hourInBlock.toString().padStart(2, "0")}`; // "YYYY-MM-DDTHH"

            return hourly.time.findIndex((/** @type {string} */ time) =>
                time.startsWith(targetHourISOStart),
            );
        })
        .filter((index) => index !== -1); // Filter out hours not found in data

    pressureLevelKeys.forEach(({ pressureNum, speedKey, directionKey }) => {
        if (isCurrentBlock && currentHourIndex !== -1) {
            // Use exact data for the current hour if available
            // Use exact data for the current hour if available
            const speed = hourly[speedKey]?.[currentHourIndex];
            const direction = hourly[directionKey]?.[currentHourIndex];
            result[pressureNum] = {
                // Ensure values are numbers or null
                speed: typeof speed === 'number' ? speed : null,
                direction: typeof direction === 'number' ? direction : null,
            };
        } else {
            // Calculate average for the 3-hour block
            const speeds = /** @type {number[]} */ (relevantIndices
                .map((i) => hourly[speedKey]?.[i])
                .filter((s) => typeof s === 'number' && !isNaN(s))); // Assert type on expression
            const directions = /** @type {number[]} */ (relevantIndices
                .map((i) => hourly[directionKey]?.[i])
                .filter((d) => typeof d === 'number' && !isNaN(d))); // Assert type on expression

            // Simple arithmetic mean for speed
            const avgSpeed =
                speeds.length > 0
                    ? speeds.reduce((a, b) => a + b, 0) / speeds.length // Type assertion on array should help reduce
                    : null;

            // Vector averaging for direction (more accurate for circular data)
            let avgDirection = null;
            if (directions.length > 0 && speeds.length === directions.length) { // Ensure speed exists for direction vector
                 let sumX = 0;
                 let sumY = 0;
                 for(let i = 0; i < directions.length; i++) {
                     // Assert non-null/undefined because of the filter and length check
                     const speed = speeds[i];
                     const direction = directions[i];
                     // Check type just in case, although filter should guarantee it
                     if (typeof speed === 'number' && typeof direction === 'number') {
                         const directionRad = direction * (Math.PI / 180);
                         sumX += speed * Math.sin(directionRad);
                         sumY += speed * Math.cos(directionRad);
                     }
                 }
                 if (sumX !== 0 || sumY !== 0) {
                    const avgDirectionRad = Math.atan2(sumX, sumY);
                    avgDirection = (avgDirectionRad * (180 / Math.PI) + 360) % 360; // Convert back to degrees [0, 360)
                 } else if (directions.length > 0) {
                    // Default to first direction if vector sum is zero (e.g., all calm)
                    avgDirection = directions[0];
                 }
            } else if (directions.length > 0) {
                // Fallback to arithmetic mean if speeds are missing or lengths mismatch
                 console.warn("Calculating arithmetic mean for direction due to missing speeds or mismatch.");
                 // Type assertion on array should help reduce
                 const sumOfDirections = directions.reduce((a, b) => a + b, 0);
                 // Ensure division is safe
                 if (directions.length > 0) {
                     // Check if sumOfDirections is a valid number before division
                     if (typeof sumOfDirections === 'number') {
                         avgDirection = sumOfDirections / directions.length;
                     } else {
                         console.error("sumOfDirections is not a number after reduce:", sumOfDirections);
                         avgDirection = null; // Handle unexpected case
                     }
                 }
            }


            result[pressureNum] = {
                speed: avgSpeed, // Already number | null
                // Ensure the final value is number or null
                direction: typeof avgDirection === 'number' && !isNaN(avgDirection) ? avgDirection : null,
            };
        }
    });

    // Pass the original targetHour for class logic, but indicate if it's the current block
    return { data: result, isCurrentBlock };
}


/**
 * Determines the CSS class for wind speed based on speed (m/s) and height category.
 * @param {number|null} speed Speed in m/s.
 * @param {string|null} height Approximate height string (e.g., "110", "1500").
 */
const getWindSpeedClass = (speed, height) => {
    if (isNullish(speed) || isNullish(height)) {
        return "";
    }

    if (ON_CANOPY_HEIGHTS.includes(height)) {
        if (speed < 8) return WIND_SPEED_CLASSES[0];
        if (speed < 11) return WIND_SPEED_CLASSES[1];
        if (speed < 13) return WIND_SPEED_CLASSES[2]; // Oranssi 11-12 m/s
        return WIND_SPEED_CLASSES[3]; // Punainen 13 m/s ja yli
    } else if (FREE_FALL_HEIGHTS.includes(height)) {
        if (speed < 8) return WIND_SPEED_CLASSES[0];
        if (speed < 13) return WIND_SPEED_CLASSES[1];
        if (speed < 18) return WIND_SPEED_CLASSES[2];
        return WIND_SPEED_CLASSES[3];
    }
    return "";
};

/**
 * @param {number|string} num
 */
function roundToNearestFive(num) {
    return Math.round(Number(num) / 5) * 5;
}

/**
 * @param {Object} props
 * @param {number|null} props.direction
 */
export function WindArrow({ direction }) {
    if (isNullish(direction)) {
        return null;
    }

    const arrow = "➤";
    const rotationDegree = direction + 90;
    return html`
        <span
            style=${{
                display: "inline-block",
                transform: `rotate(${rotationDegree}deg)`,
            }}
        >
            ${arrow}
        </span>
    `;
}

/**
 * @param {Object} props
 * @param {Object} props.data
 * @param {number|null} props.data.speed
 * @param {number|null} props.data.direction
 * @param {string} props.columnClass
 * @param {string} props.height
 */
export function WindCell({ data, columnClass, height }) {
    if (!data || isNullish(data.speed) || isNullish(data.direction)) {
        // Render placeholder if data or essential properties are missing
        return html`<td class=${columnClass}>-</td>`;
    }

    const { speed, direction } = data; // Now guaranteed to be non-nullish
    const speedInMS = Math.round(speed / 3.6);
    const roundedDirection = roundToNearestFive(direction.toFixed(0));

    return html`
        <td
            class=${`wind-cell ${columnClass} ${getWindSpeedClass(
                speedInMS,
                height,
            )}`}
        >
            <div class="wind-speed">${speedInMS} m/s</div>
            <div class="wind-direction">
                ${roundedDirection}°
                <${WindArrow} direction=${roundedDirection} />
            </div>
        </td>
    `;
}

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {OpenMeteoDayData} props.tableData
 */
export function WindTable({ title, tableData }) {
    if (!tableData) return null;

    const currentHour = new Date().getHours();
    const blockStartHour = Math.floor(currentHour / 3) * 3;

    /**
     * @param {string}  hour
     * @param {boolean} isCurrentBlock
     */
    function getColumnClass(hour, isCurrentBlock) {
        if (title === "Tänään") {
            if (isCurrentBlock) return "current-column";
            if (parseInt(hour) < blockStartHour) return "past-column";
        }
        return "";
    }

    return html`
        <table class="wind-table upperwinds-compact">
            <thead>
                <tr>
                    <th colspan=${Object.keys(tableData).length + 1}>
                        ${title}
                    </th>
                </tr>
                <tr>
                    <th></th>
                    ${Object.entries(tableData).map(
                        ([hour, { isCurrentBlock }]) => {
                            const startHour = parseInt(hour);
                            const endHour = (startHour + 3) % 24;
                            const timeRange = `${startHour.toString().padStart(2, "0")}-${endHour.toString().padStart(2, "0")}`;
                            return html`
                                <th
                                    class=${`time-header ${getColumnClass(
                                        hour,
                                        isCurrentBlock,
                                    )}`}
                                >
                                    ${isCurrentBlock
                                        ? `${currentHour}:00`
                                        : timeRange}
                                </th>
                            `;
                        },
                    )}
                </tr>
            </thead>
            <tbody>
                ${PRESSURE_LEVELS_DISPLAY.map(
                    ({ pressure, height }) => html`
                        <tr key=${pressure}>
                            <td class="pressure-cell">${height}</td>
                            ${Object.entries(tableData).map(
                                ([
                                    hour,
                                    { data: hourData, isCurrentBlock },
                                ]) => html`
                                    <${WindCell}
                                        key=${hour}
                                        data=${hourData[
                                            pressure.split(" ")[0] ?? ""
                                        ]}
                                        columnClass=${getColumnClass(
                                            hour,
                                            isCurrentBlock,
                                        )}
                                        height=${height}
                                    />
                                `,
                            )}
                        </tr>
                    `,
                )}
            </tbody>
        </table>
    `;
}

// --- Main UI Components ---

/**
 * Renders the wind forecast table for today or tomorrow.
 * Handles the loading state based on OM_DATA signal.
 * @param {Object} props
 * @param {boolean} props.tomorrow - If true, renders tomorrow's data, otherwise today's.
 */
export function OpenMeteoTool({ tomorrow }) {
    const rawData = OM_DATA.value; // Get the raw data signal value

    // Show loading indicator if data is not yet available
    if (!rawData) {
        // Check if fetchHighWinds has been called and failed implicitly
        // A more explicit loading/error state signal could be used here.
        return html`<div class="loading-placeholder">Ladataan ylätuulia...</div>`;
    }

    // Format the data only when rawData is available
    // formatTableData should handle potential issues within the raw data structure
    // if validation in fetch/cache somehow missed something, though it aims not to.
    const formattedTableData = formatTableData(rawData.hourly);

    if (!formattedTableData) {
         // This case should ideally not happen if validation works, but good as a fallback
         return html`<div class="error-placeholder">Ylätuulidatan formatointi epäonnistui.</div>`;
    }


    return html`
        <${WindTable}
            title=${tomorrow ? "Huomenna" : "Tänään"}
            tableData=${tomorrow
                ? formattedTableData.tomorrowData
                : formattedTableData.todayData}
        />
    `;
}

/**
 * Renders a table displaying the raw hourly wind data from OpenMeteo.
 * Useful for debugging or detailed inspection.
 */
export function OpenMeteoRaw() {
    const rawData = OM_DATA.value;

    if (!rawData) {
        return html`<div class="loading-placeholder">Ladataan raakadataa...</div>`;
    }

    // Ensure the data structure is somewhat valid before accessing deeply nested props
    if (!isValidOpenMeteoData(rawData)) {
         return html`<div class="error-placeholder">Raakadata on virheellistä.</div>`;
    }

    const hourly = rawData.hourly;
    // Add type annotation for map callback parameter
    const timeSlots = hourly.time.map((/** @type {string} */ time) => new Date(time)); // Keep as Date objects for clarity

    return html`
        <div class="raw-data-container">
            <h3>Raaka Tuntidata (OpenMeteo)</h3>
            <table class="wind-table upperwinds-raw">
                <thead>
                    <tr>
                        <th>Aika (UTC)</th>
                        ${PRESSURE_LEVELS_API_MAP.map(
                            ({ pressure }) => html`<th>${pressure} (m/s | °)</th>`,
                        )}
                    </tr>
                </thead>
                <tbody>
                    {/* Add type annotations for map callback parameters */}
                    ${timeSlots.map((/** @type {Date} */ time, /** @type {number} */ index) => html`
                        <tr key=${time.toISOString()}>
                            <td>${time.toISOString().substring(11, 16)}</td>
                            ${PRESSURE_LEVELS_API_MAP.map(
                                ({ speedKey, directionKey }) => {
                                    const speedKmh = hourly[speedKey]?.[index];
                                    const direction = hourly[directionKey]?.[index];
                                    // Ensure values are numbers before calculation/formatting
                                    const speedMs = typeof speedKmh === 'number' ? (speedKmh / 3.6).toFixed(1) : "-";
                                    const dirStr = typeof direction === 'number' ? direction.toFixed(0) : "-";

                                    return html`<td>${speedMs} | ${dirStr}</td>`;
                                }
                            )}
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `;
}

// --- Type Definitions (JSDoc) ---
// Keep existing type definitions, potentially add/update based on changes

/**
 * @typedef {import('./types.d.ts').OpenMeteoWeatherData} OpenMeteoWeatherData
 * @typedef {import('./types.d.ts').OpenMeteoHourlyData} OpenMeteoHourlyData
 * @typedef {import('./types.d.ts').OpenMeteoDayData} OpenMeteoDayData
 * @typedef {import('./types.d.ts').AverageWindSpeeds} AverageWindSpeeds
 * @typedef {import('./types.d.ts').OpenMeteoPressureLevel} OpenMeteoPressureLevel
 */
