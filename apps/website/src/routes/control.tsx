import { createFileRoute } from '@tanstack/react-router';

import { Button } from '../components/button';
import { Slider } from '../components/slider';
import { controlEngine } from '../lib/realtime/engines/control-engine';
import { useControlStore } from '../lib/realtime/stores/control-store';

type ControlSearch = {
    // Optional label so multiple control clients can be distinguished in the simulator.
    operator: string;
};

export const Route = createFileRoute('/control')({
    validateSearch: (search: Record<string, unknown>): ControlSearch => {
        return {
            // Default operator id keeps the route usable when query params are omitted.
            operator: typeof search.operator === 'string' ? search.operator : 'A'
        };
    },
    component: ControlPage
});

function ControlPage() {
    // `/control` models a handheld/operator endpoint:
    // - it sends intent (city and zoom) into the websocket bus
    // - it does not render the heavy map visuals itself
    // This separation mirrors operational setups where controllers and wall screens have
    // different hardware constraints and UX goals.
    const { operator } = Route.useSearch();
    const sliderValue = useControlStore((state) => state.sliderValue);
    const selectedCity = useControlStore((state) => state.selectedCity);

    return (
        <main className="h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex h-full w-full flex-col p-3">
                <header className="mb-3 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Operator
                        </p>
                        <h1 className="text-sm font-semibold">Control Panel {operator}</h1>
                    </div>
                    <span className="rounded-full bg-[var(--primary)] px-2 py-1 text-[10px] font-medium text-[var(--primary-foreground)]">
                        /control
                    </span>
                </header>

                <section className="flex gap-4">
                    <div className="grid gap-2">
                        <Button
                            // City selection emits a deterministic map-view command to all screens.
                            onClick={() => controlEngine.selectCity('london')}
                            variant={selectedCity === 'london' ? 'highlight' : 'normal'}
                            className="text-left"
                        >
                            London
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Slider
                            value={sliderValue}
                            // Slider updates are throttled inside the engine before broadcasting.
                            onValueChange={(value) => controlEngine.setSliderValue(value)}
                            onInteractionChange={(isInteracting) =>
                                controlEngine.setSliderInteracting(isInteracting)
                            }
                        />
                        <p className="text-xs text-[var(--muted-foreground)]">Map zoom</p>
                    </div>
                </section>
            </div>
        </main>
    );
}
