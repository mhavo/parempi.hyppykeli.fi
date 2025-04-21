// @ts-check

import { html } from "htm/preact";
import { useEffect, useRef } from "preact/hooks";
import { computed } from "@preact/signals";
import { WIND_VARIATIONS } from "./data.js"; // LATEST_OBSERVATION ei käytetä tässä tiedostossa
import { debug } from "./utils.js";

// --- Oletusarvot lataustilalle ---
const DEFAULT_COLOR = "lightgrey"; // Harmaa väri latauksen aikana
const DEFAULT_SWING = { angle: 5, duration: 5 }; // Hidas, pieni heilunta
const DEFAULT_ROTATION = { angle: 0, duration: 0 }; // Ei rotaatiota oletuksena
// ---

/**
 * Helper to check if wind variation data is ready and valid.
 * @type {import("@preact/signals").ReadonlySignal<boolean>}
 */
const isDataReady = computed(() => {
    const variations = WIND_VARIATIONS.value;
    // Data is ready if variations is an object and has a valid windRef number
    return !!variations && typeof variations.windRef === "number";
});


/**
 * Calculates common animation parameters based on input factors.
 * @param {number} baseAngle - The base angle for the animation.
 * @param {number} baseDuration - The base duration for the animation.
 * @param {number} variationFactor - A factor representing the variation in wind.
 * @param {number} windRef - The wind reference value.
 * @returns {{ angle: number, duration: number }} The calculated animation parameters.
 */
const calculateAnimationParams = (
    baseAngle,
    baseDuration,
    variationFactor,
    windRef,
) => {
    const windRefFactor = Math.min((windRef ?? 0) / 10, 1);
    const angle = baseAngle * (1 + windRefFactor);
    const duration = baseDuration / (1 + windRefFactor);
    return { angle, duration };
};

/**
 * Computed signal that determines the color of the parachute based on wind variations.
 * Defaults to DEFAULT_COLOR if data is not ready.
 * @type {import("@preact/signals").ReadonlySignal<string>}
 */
const displayColor = computed(() => {
    return isDataReady.value
        ? WIND_VARIATIONS.value?.color ?? DEFAULT_COLOR // Käytä data-väriä tai oletusta jos datasta puuttuu
        : DEFAULT_COLOR;
});


/**
 * Returns default rotation if data is not ready.
 * @type {import("@preact/signals").ReadonlySignal<{ angle: number, duration: number }>}
 */
const displayRotationAnimation = computed(() => {
    if (!isDataReady.value) {
        return DEFAULT_ROTATION;
    }
    // Data is ready, calculate based on WIND_VARIATIONS
    // Varmistetaan että windVariations on olemassa (vaikka isDataReady tarkistaa sen)
    const windVariations = WIND_VARIATIONS.value;
    if (!windVariations) return DEFAULT_ROTATION; // Varmuuden vuoksi

    // Nyt tiedetään että windVariations ja sen tarvittavat osat ovat olemassa
    const { variationRange, windRef, maxGust } = windVariations;

    const angle = Math.min(variationRange ?? 0, 180); // Use nullish coalescing for safety
    const baseDuration = calculateBaseDuration(variationRange);
    const { angle: calculatedAngle, duration } = calculateAnimationParams(
        angle,
        baseDuration,
        variationRange,
        windRef,
    );

    logDebugInfo(calculatedAngle, duration, variationRange, windRef);

    // Jos puuska on alle 1, palautetaan kulma 0, mutta kesto säilyy samana
    // Use nullish coalescing for safety, although check above should prevent null/undefined
    const finalAngle = (maxGust ?? 0) < 4 ? 0 : calculatedAngle;
    return { angle: finalAngle, duration };
});

/**
 * @param {number} variationRange
 */
function calculateBaseDuration(variationRange) {
    return Math.max(5 - variationRange * 0.05, 2);
}

/**
 * @param {number} angle
 * @param {number} duration
 * @param {number} variationRange
 * @param {number} windRef
 */
function logDebugInfo(angle, duration, variationRange, windRef) {
    debug(
        `Rotation animation calculated: duration=${duration}, angle=${angle}, variationRange=${variationRange}, windRef=${windRef}`,
    );
}
/**
 * Returns default swing if data is not ready.
 * @type {import("@preact/signals").ReadonlySignal<{ angle: number, duration: number }>}
 */
const displaySwingAnimation = computed(() => {
    if (!isDataReady.value) {
        return DEFAULT_SWING;
    }
    // Data is ready, calculate based on WIND_VARIATIONS
    const windVariations = WIND_VARIATIONS.value;
    if (!windVariations) return DEFAULT_SWING; // Varmuuden vuoksi

    // Nyt tiedetään että windVariations ja sen tarvittavat osat ovat olemassa
    const { averageSpeed, maxGust, windRef } = windVariations;
    const gustDiff = Math.max(0, maxGust - averageSpeed); // Varmista ettei ole negatiivinen

    // Calculate the base angle and duration for the swing
    const baseAngle = Math.min(gustDiff * 2, 35); // gustDiff is guaranteed to be a number
    const baseDuration = Math.max(2 - gustDiff * 0.15, 1);

    const { angle, duration } = calculateAnimationParams(
        baseAngle,
        baseDuration,
        gustDiff,
        windRef,
    );

    debug(
        `Swing animation calculated: angle=${angle}, duration=${duration}, gustDiff=${gustDiff}, windRef=${windRef}`,
    );
    return { angle, duration };
});

/**
 * Component that renders a dynamic parachute with animations based on wind data.
 * The parachute's color, rotation, and swing are controlled by wind variations.
 */
export function DynamicParachute() {
    /** @type {import("preact/compat").MutableRefObject<SVGElement|null>} */
    const svgRef = useRef(null);

    /**
     * Applies the parachute color and animations to the SVG element.
     */
    useEffect(() => {
        if (svgRef.current instanceof SVGElement) {
            const svg = svgRef.current;
            const swingContainer = svg.closest(".swing-container");
            const rotateContainer = svg.closest(".rotate-container");

            // Käytä displayColor-signaalia
            svg.style.setProperty("--parachute-color", displayColor.value);

            if (swingContainer instanceof HTMLElement) {
                // Käytä displaySwingAnimation-signaalia
                const { angle, duration } = displaySwingAnimation.value;
                swingContainer.style.setProperty(
                    "--swing-angle",
                    `${angle}deg`, // Aseta aina kulma, vaikka se olisi 0
                );
                // Aseta animaatio vain jos kesto > 0
                if (duration > 0) {
                    swingContainer.style.setProperty(
                        "--swing-animation",
                        `swing ${duration}s ease-in-out infinite alternate`,
                    );
                    debug(
                        `Swing animation applied: ${swingContainer.style.getPropertyValue("--swing-animation")}`,
                    );
                } else {
                    swingContainer.style.removeProperty("--swing-animation");
                    debug("Swing animation removed (duration 0)");
                    }
            }

            if (rotateContainer instanceof HTMLElement) {
                // Käytä displayRotationAnimation-signaalia
                const { angle, duration } = displayRotationAnimation.value;
                if (angle > 0 && duration > 0) {
                    rotateContainer.style.setProperty(
                        "--rotate-angle",
                        `${angle}deg`, // Aseta aina kulma
                    );
                    // Aseta --rotate-animation erikseen
                    rotateContainer.style.setProperty(
                        "--rotate-animation",
                        `rotate ${duration}s linear infinite alternate`,
                    );
                    debug(
                        `Rotate animation applied: ${rotateContainer.style.getPropertyValue("--rotate-animation")}`,
                    );
                } else {
                    // Poista animaatio jos kulma tai kesto on 0
                    rotateContainer.style.removeProperty("--rotate-animation");
                        debug("Rotate animation removed (angle or duration 0)");
                    }
            }
        }
    }, [
        // Päivitä riippuvuudet käyttämään uusia display*-signaaleja
        displayColor.value,
        displaySwingAnimation.value,
        displayRotationAnimation.value,
    ]);

    return html`
        <style>
            @keyframes swing {
                0% {
                    transform: rotate(var(--swing-angle));
                }
                100% {
                    transform: rotate(calc(-1 * var(--swing-angle)));
                }
            }
            @keyframes rotate {
                0% {
                    transform: rotateY(calc(-1 * var(--rotate-angle) / 2));
                }
                100% {
                    transform: rotateY(calc(var(--rotate-angle) / 2));
                }
            }
            .rotate-container {
                width: 100px;
                height: 100px;
                display: inline-block;
                animation: var(--rotate-animation, none);
            }
            .swing-container {
                width: 100%;
                height: 100%;
                display: inline-block;
                transform-origin: center top;
                animation: var(--swing-animation, none); /* Lisää none varmuuden vuoksi */
                /* Lisää transition transformille pehmeämpää animaation vaihtoa varten */
                transition: transform 0.5s ease-in-out;
            }
            .dynamic-parachute {
                width: 100%;
                height: 100%;
                fill: var(--parachute-color);
                /* Lisää transition värille */
                transition: fill 0.5s ease-in-out;
            }
            /* .parachute-color luokkaa ei käytetä, voi poistaa jos haluaa */
            .parachute-color {
                fill: var(--parachute-color);
            }
        </style>
        <div class="rotate-container">
            <div class="swing-container">
                <svg
                    ref=${svgRef}
                    class="dynamic-parachute"
                    viewBox="0 0 512 512"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <use href="/assets/parachute.svg#g3069" />
                </svg>
            </div>
        </div>
    `;
}
