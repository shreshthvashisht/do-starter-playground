import { WebMercatorViewport } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { createFileRoute, useLocation } from '@tanstack/react-router';
import { Map, type MapRef } from '@vis.gl/react-maplibre';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { screenEngine } from '../lib/realtime/engines/screen-engine';
import { useScreenStore } from '../lib/realtime/stores/screen-store';
import type { ArcSegment, ScreenMapViewState } from '../lib/realtime/types';

import '@fontsource-variable/space-grotesk';
import 'maplibre-gl/dist/maplibre-gl.css';

const WALL_COLS = 3;
const WALL_ROWS = 2;
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;
// Shared animation timings so transitions feel identical across all screen nodes.
const MAP_TRANSITION_DURATION_MS = 1200;
const LINE_REVEAL_DURATION_MS = 2000;
const LINE_REVEAL_STEPS = 96;
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SEGMENTS_SOURCE_ID = 'segments-source';
const SEGMENTS_LAYER_ID = 'segments-layer';
const MARKERS_SOURCE_ID = 'markers-source';
const MARKERS_LAYER_ID = 'markers-layer';
const PTAL_IMAGE_URL = '/ptal_ai.png';
const PTAL_IMAGE_SOURCE_ID = 'ptal-image-source';
const PTAL_IMAGE_LAYER_ID = 'ptal-image-layer';
// Corners in MapLibre order: top-left, top-right, bottom-right, bottom-left (lon, lat).
const PTAL_IMAGE_COORDINATES: [
    [number, number],
    [number, number],
    [number, number],
    [number, number]
] = [
    [-0.51174, 51.69357],
    [0.33544, 51.69357],
    [0.33544, 51.28533],
    [-0.51174, 51.28533]
];
// PTAL 2023 compact rows: [lon, lat, level 0-8, AI, bus score].
// Levels map to 0, 1a, 1b, 2, 3, 4, 5, 6a, 6b.
const PTAL_URL = '/ptal_compact.json';
// Circles slightly larger than the 100 m squares so neighbours touch.
const PTAL_SQUARE_RADIUS_M = 60;
// Starter-kit city arcs, switched off for the PTAL story.
const SHOW_DEMO_ARCS = false;
// Viridis-style ramp, dark (no access) to bright (excellent access).
const PTAL_COLORS: Array<[number, number, number, number]> = [
    [68, 1, 84, 230],
    [72, 40, 120, 230],
    [62, 74, 137, 230],
    [49, 104, 142, 230],
    [38, 130, 142, 230],
    [31, 158, 137, 230],
    [53, 183, 121, 230],
    [109, 205, 89, 230],
    [253, 231, 37, 230]
];
const PTAL_RGB_COLORS = PTAL_COLORS.map(([red, green, blue]) => `rgb(${red}, ${green}, ${blue})`);

// Story copy and figures come from the PTAL 2023 grid (159,451 squares; 47.0% = levels 0, 1a, 1b; 5.9% = levels 6a, 6b; shares of 100 m grid squares, which means area, not people).
const PTAL_GRID_SQUARE_COUNT = 159_451;
const STORY_TITLE_LINE_ONE = 'Who is';
const STORY_TITLE_LINE_TWO = "London's";
const STORY_TITLE_HIGHLIGHT = 'network';
const STORY_TITLE_LINE_FOUR = 'built for?';
const PTAL_DEFINITION_HEADING = 'What is PTAL?';
const PTAL_DEFINITION_BODY =
    'Public Transport Access Level. Each 100 m square of London is scored by walking time to stops and how often services run.';
// 8vh to 12vh lines are secondary text and need design-review approval.
const LOW_ACCESS_FIGURE = '47%';
const LOW_ACCESS_AREA_PREFIX = "Of London's area is ";
const LOW_ACCESS_BAND = 'PTAL 0 to 1b';
const LOW_ACCESS_DESCRIPTION = 'Little or no service within walking distance';
const EXCELLENT_ACCESS_FIGURE = '5.9%';
const EXCELLENT_ACCESS_AREA_PREFIX = "Of London's area is ";
const EXCELLENT_ACCESS_BAND = 'PTAL 6a to 6b';
const EXCELLENT_ACCESS_DESCRIPTION = 'Excellent access: Access Index above 25';
// legend and credit text is below the 20vh budget, needs design-review approval
const PTAL_LEGEND_CAPTION = 'PTAL band, 0 (lowest) to 6b (highest)';
const PTAL_BAND_CODES = ['0', '1a', '1b', '2', '3', '4', '5', '6a', '6b'];
const PTAL_DATA_CREDIT =
    'Data: Transport for London. © Crown copyright and database rights 2026 Ordnance Survey AC0000806239.';

// Each `/screen` instance represents one wall tile (`c`,`r`) and computes
// a local camera from shared wall state. We keep a lighter fallback renderer for
// iframe deployments where multiple WebGL contexts are active at once.

type CurvedSegment = {
    id: string;
    source: [number, number];
    target: [number, number];
    weight: number;
    t: number;
};

type CurvedPath = {
    id: string;
    coordinates: Array<[number, number]>;
    weight: number;
};

type SiteMarker = {
    id: string;
    position: [number, number];
    weight: number;
};

type PtalRow = [lon: number, lat: number, level: number, ai: number, bus: number];

export const Route = createFileRoute('/screen')({
    component: ScreenPage
});

function ScreenPage() {
    const { search } = useLocation();
    // Query params identify which physical panel this route instance represents.
    const searchParams = (search as Record<string, unknown>) ?? {};
    const screenC = parseScreenCoordinate(searchParams.c, WALL_COLS, 0);
    const screenR = parseScreenCoordinate(searchParams.r, WALL_ROWS, 0);

    const mapView = useScreenStore((state) => state.mapView);
    const arcSegments = useScreenStore((state) => state.arcSegments);
    const selectedSegmentIndexes = useScreenStore((state) => state.selectedSegmentIndexes);
    const [isClient, setIsClient] = useState(false);
    const [useDeckWrapper, setUseDeckWrapper] = useState(false);
    const [animatedBaseMapView, setAnimatedBaseMapView] = useState(mapView);
    const [deckRevealProgress, setDeckRevealProgress] = useState(1);
    const animationFrameRef = useRef<number | null>(null);
    const lineRevealFrameRef = useRef<number | null>(null);
    const deckRevealFrameRef = useRef<number | null>(null);
    const lastRevealedPathsRef = useRef<CurvedPath[] | null>(null);
    const lastRevealedDeckSegmentsRef = useRef<CurvedSegment[] | null>(null);
    const [mapInstance, setMapInstance] = useState<ReturnType<MapRef['getMap']> | null>(null);
    const [ptalRows, setPtalRows] = useState<PtalRow[]>([]);

    useEffect(() => {
        let cancelled = false;
        fetch(PTAL_URL)
            .then((response) => {
                if (!response.ok) throw new Error(`PTAL fetch failed: ${response.status}`);
                return response.json() as Promise<unknown>;
            })
            .then((data) => {
                if (cancelled) return;
                if (!isPtalData(data)) throw new Error('PTAL data has an unexpected shape');
                setPtalRows(data);
            })
            .catch((error) => console.error(error));
        return () => {
            cancelled = true;
        };
    }, []);

    const setMapRef = useCallback((instance: MapRef | null) => {
        setMapInstance(instance?.getMap() ?? null);
    }, []);

    useEffect(() => {
        setIsClient(true);
        // Avoid DeckGL context exhaustion in a 6-iframe wall layout.
        // `window.top` path is used when opening a screen directly in its own tab, where one
        // high-level DeckGL canvas is typically safe.
        setUseDeckWrapper(window.self === window.top);
        void screenEngine.ensureArcSegmentsLoaded();
    }, []);

    useEffect(() => {
        if (!isClient) return;

        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        const from = animatedBaseMapView;
        const to = mapView;
        const startTime = performance.now();

        const step = (now: number) => {
            const elapsed = now - startTime;
            const linearT = Math.min(1, elapsed / MAP_TRANSITION_DURATION_MS);
            const t = easeInOutCubic(linearT);

            setAnimatedBaseMapView(interpolateMapView(from, to, t));

            if (linearT < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = null;
            }
        };

        animationFrameRef.current = requestAnimationFrame(step);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [isClient, mapView]);

    useEffect(() => {
        return () => {
            if (lineRevealFrameRef.current !== null) {
                cancelAnimationFrame(lineRevealFrameRef.current);
                lineRevealFrameRef.current = null;
            }
            if (deckRevealFrameRef.current !== null) {
                cancelAnimationFrame(deckRevealFrameRef.current);
                deckRevealFrameRef.current = null;
            }
        };
    }, []);

    const localScreenMapView = useMemo(() => {
        // Transform shared wall center view into per-panel view by offsetting camera in pixels.
        return deriveScreenMapView(animatedBaseMapView, screenC, screenR);
    }, [animatedBaseMapView, screenC, screenR]);

    const filteredArcSegments = useMemo(() => {
        // Empty selection means "show all" for quick demo exploration.
        if (selectedSegmentIndexes.length === 0) return arcSegments;
        const selectedIndexSet = new Set(selectedSegmentIndexes);
        return arcSegments.filter((_, index) => selectedIndexSet.has(index));
    }, [arcSegments, selectedSegmentIndexes]);

    const curvedSegments = useMemo(
        () => buildCurvedSegments(filteredArcSegments),
        [filteredArcSegments]
    );
    const curvedPaths = useMemo(() => buildCurvedPaths(filteredArcSegments), [filteredArcSegments]);
    const siteMarkers = useMemo(() => buildSiteMarkers(filteredArcSegments), [filteredArcSegments]);
    const revealedDeckSegments = useMemo(
        () => curvedSegments.filter((segment) => segment.t <= deckRevealProgress),
        [curvedSegments, deckRevealProgress]
    );
    const segmentsGeojson = useMemo(
        () =>
            ({
                type: 'FeatureCollection',
                features: curvedPaths.map((segment) => ({
                    type: 'Feature',
                    properties: {
                        id: segment.id,
                        weight: segment.weight
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: segment.coordinates
                    }
                }))
            }) as const,
        [curvedPaths]
    );
    const markersGeojson = useMemo(
        () =>
            ({
                type: 'FeatureCollection',
                features: siteMarkers.map((marker) => ({
                    type: 'Feature',
                    properties: {
                        id: marker.id,
                        weight: marker.weight
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: marker.position
                    }
                }))
            }) as const,
        [siteMarkers]
    );

    useEffect(() => {
        if (!isClient || !useDeckWrapper) return;

        // Use reference checks instead of rebuilding ID signatures each update.
        // `curvedSegments` is memoized, so a new reference already means meaningful data change.
        if (lastRevealedDeckSegmentsRef.current === curvedSegments) return;
        lastRevealedDeckSegmentsRef.current = curvedSegments;

        if (deckRevealFrameRef.current !== null) {
            cancelAnimationFrame(deckRevealFrameRef.current);
            deckRevealFrameRef.current = null;
        }

        setDeckRevealProgress(0);
        const startTime = performance.now();
        const tick = (now: number) => {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / LINE_REVEAL_DURATION_MS);
            setDeckRevealProgress(t);

            if (t < 1) {
                deckRevealFrameRef.current = requestAnimationFrame(tick);
            } else {
                deckRevealFrameRef.current = null;
            }
        };

        deckRevealFrameRef.current = requestAnimationFrame(tick);
    }, [curvedSegments, isClient, useDeckWrapper]);

    const lineLayer = useMemo(
        () =>
            new LineLayer<CurvedSegment>({
                id: 'segments-lines',
                // Progressive reveal keeps motion legible and avoids visual "pop in".
                data: revealedDeckSegments,
                getSourcePosition: (d) => d.source,
                getTargetPosition: (d) => d.target,
                getWidth: (d) => 3 + d.weight * 0.3,
                widthUnits: 'pixels',
                getColor: (d) => {
                    return [
                        Math.round(lerp(255, 255, d.t)),
                        Math.round(lerp(72, 224, d.t)),
                        Math.round(lerp(72, 102, d.t)),
                        242
                    ];
                },
                pickable: false
            }),
        [revealedDeckSegments]
    );

    const markerLayer = useMemo(
        () =>
            new ScatterplotLayer<SiteMarker>({
                id: 'site-markers',
                data: siteMarkers,
                getPosition: (d) => d.position,
                getRadius: (d) => 7 + d.weight * 1.4,
                radiusUnits: 'pixels',
                radiusMinPixels: 7,
                radiusMaxPixels: 28,
                stroked: true,
                lineWidthMinPixels: 2.5,
                getLineColor: [255, 250, 210, 255],
                getFillColor: [255, 255, 255, 255],
                pickable: false
            }),
        [siteMarkers]
    );

    const ptalLayer = useMemo(
        () =>
            new ScatterplotLayer<PtalRow>({
                id: 'ptal-squares',
                data: ptalRows,
                getPosition: (d) => [d[0], d[1]],
                getFillColor: (d) => PTAL_COLORS[d[2]],
                radiusUnits: 'meters',
                getRadius: PTAL_SQUARE_RADIUS_M,
                pickable: false
            }),
        [ptalRows]
    );

    useEffect(() => {
        if (!isClient || useDeckWrapper) return;

        if (!mapInstance) return;

        const syncLines = () => {
            if (!mapInstance.isStyleLoaded()) return;

            try {
                if (!mapInstance.getSource(PTAL_IMAGE_SOURCE_ID)) {
                    mapInstance.addSource(PTAL_IMAGE_SOURCE_ID, {
                        type: 'image',
                        url: PTAL_IMAGE_URL,
                        coordinates: PTAL_IMAGE_COORDINATES
                    });
                }

                if (!mapInstance.getLayer(PTAL_IMAGE_LAYER_ID)) {
                    mapInstance.addLayer({
                        id: PTAL_IMAGE_LAYER_ID,
                        type: 'raster',
                        source: PTAL_IMAGE_SOURCE_ID,
                        paint: {
                            'raster-opacity': 1,
                            'raster-fade-duration': 0
                        }
                    });
                }
            } catch (error) {
                console.error('Failed to add PTAL image layer', error);
            }

            if (!SHOW_DEMO_ARCS) return;

            const startLineReveal = () => {
                if (!mapInstance.getLayer(SEGMENTS_LAYER_ID)) return;
                if (lastRevealedPathsRef.current === curvedPaths) return;
                lastRevealedPathsRef.current = curvedPaths;

                if (lineRevealFrameRef.current !== null) {
                    cancelAnimationFrame(lineRevealFrameRef.current);
                    lineRevealFrameRef.current = null;
                }

                const startTime = performance.now();
                const tick = (now: number) => {
                    const elapsed = now - startTime;
                    const t = Math.min(1, elapsed / LINE_REVEAL_DURATION_MS);

                    mapInstance.setPaintProperty(SEGMENTS_LAYER_ID, 'line-gradient', [
                        'case',
                        ['<=', ['line-progress'], t],
                        ['interpolate', ['linear'], ['line-progress'], 0, '#ff4848', 1, '#ffe066'],
                        'rgba(0,0,0,0)'
                    ]);
                    if (t < 1) {
                        lineRevealFrameRef.current = requestAnimationFrame(tick);
                    } else {
                        lineRevealFrameRef.current = null;
                        mapInstance.setPaintProperty(SEGMENTS_LAYER_ID, 'line-gradient', [
                            'interpolate',
                            ['linear'],
                            ['line-progress'],
                            0,
                            '#ff4848',
                            1,
                            '#ffe066'
                        ]);
                    }
                };

                lineRevealFrameRef.current = requestAnimationFrame(tick);
            };

            const existingMarkerSource = mapInstance.getSource(MARKERS_SOURCE_ID) as
                | { setData: (data: unknown) => void }
                | undefined;
            const existingSource = mapInstance.getSource(SEGMENTS_SOURCE_ID) as
                | { setData: (data: unknown) => void }
                | undefined;

            if (!existingMarkerSource) {
                // Create once, then update data in-place to avoid recreating layers every frame.
                mapInstance.addSource(MARKERS_SOURCE_ID, {
                    type: 'geojson',
                    data: markersGeojson as never
                });

                if (!mapInstance.getLayer(MARKERS_LAYER_ID)) {
                    mapInstance.addLayer({
                        id: MARKERS_LAYER_ID,
                        type: 'circle',
                        source: MARKERS_SOURCE_ID,
                        paint: {
                            'circle-radius': [
                                'interpolate',
                                ['linear'],
                                ['get', 'weight'],
                                0,
                                10,
                                10,
                                24
                            ],
                            'circle-color': '#ffffff',
                            'circle-opacity': 0.95,
                            'circle-stroke-color': '#fffad2',
                            'circle-stroke-width': 3,
                            'circle-blur': 0.15
                        }
                    });
                }
            } else {
                existingMarkerSource.setData(markersGeojson);
            }

            if (!existingSource) {
                mapInstance.addSource(SEGMENTS_SOURCE_ID, {
                    type: 'geojson',
                    // lineMetrics is required for `line-progress` based animated gradients.
                    lineMetrics: true,
                    data: segmentsGeojson as never
                });

                if (!mapInstance.getLayer(SEGMENTS_LAYER_ID)) {
                    mapInstance.addLayer({
                        id: SEGMENTS_LAYER_ID,
                        type: 'line',
                        source: SEGMENTS_SOURCE_ID,
                        layout: {
                            'line-cap': 'round',
                            'line-join': 'round'
                        },
                        paint: {
                            'line-opacity': 0.95,
                            'line-width': [
                                'interpolate',
                                ['linear'],
                                ['get', 'weight'],
                                0,
                                3,
                                10,
                                10
                            ],
                            'line-gradient': [
                                'interpolate',
                                ['linear'],
                                ['line-progress'],
                                0,
                                '#ff4848',
                                1,
                                '#ffe066'
                            ],
                            'line-blur': 0.2
                        }
                    });
                }

                startLineReveal();
                return;
            }

            // Fast path for updates after first mount.
            existingSource.setData(segmentsGeojson);
            startLineReveal();
        };

        syncLines();
        mapInstance.on('load', syncLines);

        return () => {
            mapInstance.off('load', syncLines);
        };
    }, [curvedPaths, isClient, mapInstance, markersGeojson, segmentsGeojson, useDeckWrapper]);

    return (
        <main className="pointer-events-none h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
            <div className="relative flex h-full w-full items-center justify-center">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(34,197,94,0.14),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.12),transparent_45%)]" />
                <div className="absolute inset-0 z-200">
                    {isClient && useDeckWrapper ? (
                        <DeckGL
                            controller={false}
                            viewState={localScreenMapView}
                            layers={
                                SHOW_DEMO_ARCS ? [ptalLayer, markerLayer, lineLayer] : [ptalLayer]
                            }
                            style={{ width: '100%', height: '100%' }}
                        >
                            <Map reuseMaps attributionControl={false} mapStyle={MAP_STYLE} />
                        </DeckGL>
                    ) : null}

                    {isClient && !useDeckWrapper ? (
                        // Iframe-safe fallback implementation: direct map rendering + imperative layers.
                        <Map
                            ref={setMapRef}
                            reuseMaps
                            attributionControl={false}
                            mapStyle={MAP_STYLE}
                            longitude={localScreenMapView.longitude}
                            latitude={localScreenMapView.latitude}
                            zoom={localScreenMapView.zoom}
                            bearing={localScreenMapView.bearing}
                            pitch={localScreenMapView.pitch}
                            style={{ width: '100%', height: '100%' }}
                        />
                    ) : null}
                </div>
                <StoryOverlay screenC={screenC} screenR={screenR} />
            </div>
        </main>
    );
}

function StoryOverlay({ screenC, screenR }: { screenC: number; screenR: number }) {
    const className =
        'pointer-events-none absolute inset-0 font-semibold leading-[1.05] text-zinc-50';
    const style = {
        zIndex: 300,
        fontFamily: '"Space Grotesk Variable", system-ui, sans-serif',
        textShadow: '0 0.1em 0.25em rgba(0, 0, 0, 0.75)'
    };

    if (screenC === 0 && screenR === 0) {
        return (
            <div className={className} style={style}>
                <div className="flex h-full items-center" style={{ padding: '4vh 4vw' }}>
                    <h2
                        className="m-0 max-w-[65vw] text-left leading-[1.02]"
                        style={{ fontSize: '20vh' }}
                    >
                        {STORY_TITLE_LINE_ONE}
                        <br />
                        {STORY_TITLE_LINE_TWO}
                        <br />
                        <Highlight>{STORY_TITLE_HIGHLIGHT}</Highlight>
                        <br />
                        {STORY_TITLE_LINE_FOUR}
                    </h2>
                </div>
            </div>
        );
    }

    if (screenC === 0 && screenR === 1) {
        return (
            <div className={className} style={style}>
                <div className="flex h-full items-center" style={{ padding: '3vh 4vw' }}>
                    <div
                        className="flex flex-col"
                        style={{ width: '65vw', maxWidth: '65vw', gap: '2vh' }}
                    >
                        <h2 className="m-0" style={{ fontSize: '20vh' }}>
                            {PTAL_DEFINITION_HEADING}
                        </h2>
                        <p className="m-0" style={{ fontSize: 'min(10vh, 8vw)' }}>
                            {PTAL_DEFINITION_BODY}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (screenC === 1 && screenR === 0) {
        return (
            <div className={className} style={style}>
                <div
                    className="absolute"
                    style={{ top: '4vh', right: '4vw', width: '60vw', maxWidth: '60vw' }}
                >
                    <p className="m-0" style={{ fontSize: '4vh' }}>
                        {PTAL_LEGEND_CAPTION}
                    </p>
                    <div
                        role="group"
                        aria-label={`PTAL bands across ${PTAL_GRID_SQUARE_COUNT.toLocaleString()} 100 m grid squares`}
                        className="flex"
                        style={{ gap: '0.5vw', marginTop: '2vh' }}
                    >
                        {PTAL_BAND_CODES.map((band, index) => (
                            <div
                                key={band}
                                className="flex min-w-0 flex-1 flex-col items-center text-center"
                            >
                                <div
                                    style={{
                                        width: '100%',
                                        height: '6vh',
                                        backgroundColor: PTAL_RGB_COLORS[index]
                                    }}
                                />
                                <span style={{ fontSize: '4vh', marginTop: '0.5vh' }}>{band}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (screenC === 1 && screenR === 1) {
        return (
            <div className={className} style={style}>
                <p
                    className="absolute m-0"
                    style={{
                        bottom: '3vh',
                        left: '50%',
                        width: '90vw',
                        maxWidth: '90vw',
                        transform: 'translateX(-50%)',
                        textAlign: 'center',
                        fontSize: '4vh'
                    }}
                >
                    {PTAL_DATA_CREDIT}
                </p>
            </div>
        );
    }

    if (screenC === 2 && (screenR === 0 || screenR === 1)) {
        const isLowAccess = screenR === 0;
        const figure = isLowAccess ? LOW_ACCESS_FIGURE : EXCELLENT_ACCESS_FIGURE;
        const areaPrefix = isLowAccess ? LOW_ACCESS_AREA_PREFIX : EXCELLENT_ACCESS_AREA_PREFIX;
        const band = isLowAccess ? LOW_ACCESS_BAND : EXCELLENT_ACCESS_BAND;
        const description = isLowAccess ? LOW_ACCESS_DESCRIPTION : EXCELLENT_ACCESS_DESCRIPTION;

        return (
            <div className={className} style={style}>
                <div
                    className="flex h-full items-center justify-end"
                    style={{ padding: '3vh 4vw' }}
                >
                    <div className="text-right" style={{ width: '65vw', maxWidth: '65vw' }}>
                        <p className="m-0 font-bold" style={{ fontSize: '30vh' }}>
                            {figure}
                        </p>
                        <p className="m-0" style={{ fontSize: '12vh', marginTop: '1vh' }}>
                            {areaPrefix}
                            <Highlight>{band}</Highlight>.
                        </p>
                        <p className="m-0" style={{ fontSize: '8vh', marginTop: '1vh' }}>
                            {description}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function Highlight({ children }: { children: string }) {
    return (
        <span
            style={{
                backgroundColor: '#fde725',
                color: '#0b0b0b',
                padding: '0 0.15em',
                borderRadius: '0.1em',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone'
            }}
        >
            {children}
        </span>
    );
}

function parseScreenCoordinate(value: unknown, size: number, fallback: number) {
    // SSR and direct route probes may hit `/screen` without `c`/`r`.
    // Fail gracefully by falling back to a deterministic tile.
    if (value === null || value === undefined) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    // Clamp keeps out-of-range coordinates inside the supported wall grid.
    return Math.min(size - 1, Math.max(0, parsed));
}

function deriveScreenMapView(
    baseView: ScreenMapViewState,
    c: number,
    r: number
): ScreenMapViewState {
    // Convert wall-level geographic center to screen-local center by:
    // 1) projecting to pixels at a canonical screen resolution
    // 2) applying tile offset for row/column
    // 3) unprojecting back to lon/lat
    const viewport = new WebMercatorViewport({
        longitude: baseView.longitude,
        latitude: baseView.latitude,
        zoom: baseView.zoom,
        bearing: baseView.bearing,
        pitch: baseView.pitch,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT
    });

    const [centerX, centerY] = viewport.project([baseView.longitude, baseView.latitude]);

    const pixelOffsetX = (c + 0.5 - WALL_COLS / 2) * SCREEN_WIDTH;
    const pixelOffsetY = (r + 0.5 - WALL_ROWS / 2) * SCREEN_HEIGHT;

    const [longitude, latitude] = viewport.unproject([
        centerX + pixelOffsetX,
        centerY + pixelOffsetY
    ]);

    return {
        ...baseView,
        longitude,
        latitude
    };
}

function buildCurvedSegments(segments: ArcSegment[]) {
    const curved: CurvedSegment[] = [];

    for (const segment of segments) {
        const points = createCurvePoints(
            segment.start,
            segment.end,
            LINE_REVEAL_STEPS,
            segment.weight
        );

        for (let i = 0; i < points.length - 1; i++) {
            const denominator = Math.max(1, points.length - 2);
            curved.push({
                id: `${segment.id}-${i}`,
                source: points[i],
                target: points[i + 1],
                weight: segment.weight,
                t: i / denominator
            });
        }
    }

    return curved;
}

function buildCurvedPaths(segments: ArcSegment[]): CurvedPath[] {
    // Fewer points here reduce per-update geometry size for the fallback line source.
    return segments.map((segment) => ({
        id: segment.id,
        coordinates: createCurvePoints(segment.start, segment.end, 32, segment.weight),
        weight: segment.weight
    }));
}

function buildSiteMarkers(segments: ArcSegment[]): SiteMarker[] {
    // One marker at each endpoint communicates connection density hotspots.
    const markers: SiteMarker[] = [];

    for (const segment of segments) {
        markers.push({
            id: `${segment.id}-start`,
            position: segment.start,
            weight: segment.weight
        });
        markers.push({
            id: `${segment.id}-end`,
            position: segment.end,
            weight: segment.weight
        });
    }

    return markers;
}

function createCurvePoints(
    start: [number, number],
    end: [number, number],
    steps: number,
    weight: number
): Array<[number, number]> {
    const sx = start[0];
    const sy = start[1];
    const ex = end[0];
    const ey = end[1];

    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));

    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;

    const px = -dy / length;
    const py = dx / length;

    // Stronger bowing for long-distance links keeps arcs visually distinct at wide zoom.
    const weightFactor = 0.18 + Math.min(0.22, weight * 0.025);
    const distanceFactor = Math.pow(length, 0.9);
    const curvature = Math.min(3.4, distanceFactor * weightFactor);

    const cx = mx + px * curvature;
    const cy = my + py * curvature;

    const points: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const omt = 1 - t;

        const x = omt * omt * sx + 2 * omt * t * cx + t * t * ex;
        const y = omt * omt * sy + 2 * omt * t * cy + t * t * ey;

        points.push([x, y]);
    }

    return points;
}

function interpolateMapView(
    from: ScreenMapViewState,
    to: ScreenMapViewState,
    t: number
): ScreenMapViewState {
    return {
        longitude: lerp(from.longitude, to.longitude, t),
        latitude: lerp(from.latitude, to.latitude, t),
        zoom: lerp(from.zoom, to.zoom, t),
        bearing: lerp(from.bearing, to.bearing, t),
        pitch: lerp(from.pitch, to.pitch, t)
    };
}

function lerp(from: number, to: number, t: number) {
    return from + (to - from) * t;
}

function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function isPtalData(value: unknown): value is PtalRow[] {
    if (!Array.isArray(value) || value.length === 0) return false;
    // Spot-check the first, middle and last rows rather than all 159k.
    return [0, Math.floor(value.length / 2), value.length - 1].every((i) => {
        const row = value[i];
        return (
            Array.isArray(row) &&
            row.length === 5 &&
            row.every((n) => typeof n === 'number') &&
            row[2] >= 0 &&
            row[2] <= 8
        );
    });
}
