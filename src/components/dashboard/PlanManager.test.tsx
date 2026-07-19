// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { PlanManager } from './PlanManager';
import { INITIAL_INPUTS } from '../../utils/inputSanitizer';
import type { SavedPlan } from '../../hooks/usePlans';

function makePlan(overrides: Partial<SavedPlan> = {}): SavedPlan {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        name: overrides.name ?? 'Plan',
        inputs: overrides.inputs ?? INITIAL_INPUTS,
        lastSaved: overrides.lastSaved ?? new Date().toISOString(),
    };
}

type Handlers = {
    onRenameActive: ReturnType<typeof vi.fn<(name: string) => void>>;
    onNewPlan: ReturnType<typeof vi.fn<() => void>>;
    onActivate: ReturnType<typeof vi.fn<(id: string) => void>>;
    onDuplicate: ReturnType<typeof vi.fn<(id: string) => void>>;
    onDelete: ReturnType<typeof vi.fn<(id: string) => void>>;
    onCompare: ReturnType<typeof vi.fn<() => void>>;
};

function renderManager(opts: {
    plans: SavedPlan[];
    activePlanId?: string | null;
    activePlanName?: string;
    activeLastSaved?: string | null;
} ): Handlers {
    const { plans } = opts;
    const active = plans.find(p => p.id === opts.activePlanId) ?? plans[0];
    const handlers: Handlers = {
        onRenameActive: vi.fn<(name: string) => void>(),
        onNewPlan: vi.fn<() => void>(),
        onActivate: vi.fn<(id: string) => void>(),
        onDuplicate: vi.fn<(id: string) => void>(),
        onDelete: vi.fn<(id: string) => void>(),
        onCompare: vi.fn<() => void>(),
    };
    render(
        <PlanManager
            plans={plans}
            activePlanId={opts.activePlanId !== undefined ? opts.activePlanId : (active?.id ?? null)}
            activePlanName={opts.activePlanName ?? active?.name ?? 'My Plan'}
            activeLastSaved={
                opts.activeLastSaved !== undefined ? opts.activeLastSaved : (active?.lastSaved ?? null)
            }
            currentInputs={INITIAL_INPUTS}
            {...handlers}
        />
    );
    return handlers;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PlanManager', () => {
    it('shows the active plan name and edited date; virtual props show the not-saved copy and synthetic row', () => {
        const plan = makePlan({ name: 'My Plan', lastSaved: '2026-05-10T00:00:00.000Z' });
        renderManager({ plans: [plan] });

        expect(screen.getByRole('button', { name: 'Rename plan' })).toHaveTextContent('My Plan');
        // 'edited <date>' appears in both the header subtitle and the plan's list row.
        expect(
            screen.getAllByText(`edited ${new Date('2026-05-10T00:00:00.000Z').toLocaleDateString()}`).length
        ).toBeGreaterThanOrEqual(1);

        cleanup();

        // Virtual state: no persisted plans, no lastSaved.
        renderManager({ plans: [], activePlanId: null, activePlanName: 'My Plan', activeLastSaved: null });
        expect(screen.getByText('Not saved yet — edits save automatically')).toBeInTheDocument();
        expect(screen.getByText('Not saved yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rename plan' })).toHaveTextContent('My Plan');
    });

    it('opens the rename input on title click and commits on Enter', async () => {
        const user = userEvent.setup();
        const plan = makePlan({ name: 'Base' });
        const { onRenameActive } = renderManager({ plans: [plan] });

        await user.click(screen.getByRole('button', { name: 'Rename plan' }));
        const input = screen.getByRole('textbox');
        expect(input).toBeInTheDocument();

        await user.clear(input);
        await user.type(input, 'Renamed{Enter}');

        expect(onRenameActive).toHaveBeenCalledWith('Renamed');
    });

    it('cancels rename on Escape without calling onRenameActive', async () => {
        const user = userEvent.setup();
        const plan = makePlan({ name: 'Base' });
        const { onRenameActive } = renderManager({ plans: [plan] });

        await user.click(screen.getByRole('button', { name: 'Rename plan' }));
        await user.type(screen.getByRole('textbox'), 'Discarded{Escape}');

        expect(onRenameActive).not.toHaveBeenCalled();
        // Input is gone; display title is back.
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Rename plan' })).toHaveTextContent('Base');
    });

    it('calls onNewPlan when New Plan is clicked', async () => {
        const user = userEvent.setup();
        const { onNewPlan } = renderManager({ plans: [makePlan()] });

        await user.click(screen.getByRole('button', { name: 'New Plan' }));

        expect(onNewPlan).toHaveBeenCalledTimes(1);
    });

    it('activates on row click; duplicate/delete fire their handlers with the row id and not onActivate', async () => {
        const user = userEvent.setup();
        const a = makePlan({ name: 'Plan A' });
        const b = makePlan({ name: 'Plan B' });
        const { onActivate, onDuplicate, onDelete } = renderManager({ plans: [a, b], activePlanId: a.id });

        // Row click on the inactive plan activates it.
        await user.click(screen.getByText('Plan B'));
        expect(onActivate).toHaveBeenCalledWith(b.id);

        onActivate.mockClear();

        // Duplicate on Plan B: handler with id, no activation.
        const dupButtons = screen.getAllByRole('button', { name: 'Duplicate plan' });
        await user.click(dupButtons[1]);
        expect(onDuplicate).toHaveBeenCalledWith(b.id);
        expect(onActivate).not.toHaveBeenCalled();

        // Delete on Plan B: handler with id, no activation.
        const delButtons = screen.getAllByRole('button', { name: 'Delete plan' });
        await user.click(delButtons[1]);
        expect(onDelete).toHaveBeenCalledWith(b.id);
        expect(onActivate).not.toHaveBeenCalled();
    });

    it('disables Delete at one plan and enables it at two', () => {
        renderManager({ plans: [makePlan({ name: 'Solo' })] });
        expect(screen.getByRole('button', { name: 'Delete plan' })).toBeDisabled();

        cleanup();

        renderManager({ plans: [makePlan({ name: 'One' }), makePlan({ name: 'Two' })] });
        for (const btn of screen.getAllByRole('button', { name: 'Delete plan' })) {
            expect(btn).toBeEnabled();
        }
    });

    it('disables Compare below two plans with a caption, enables it at two', () => {
        renderManager({ plans: [makePlan()] });
        expect(screen.getByRole('button', { name: /Compare plans/ })).toBeDisabled();
        expect(screen.getByText('Create a second plan to compare')).toBeInTheDocument();

        cleanup();

        renderManager({ plans: [makePlan(), makePlan()] });
        expect(screen.getByRole('button', { name: /Compare plans/ })).toBeEnabled();
        expect(screen.queryByText('Create a second plan to compare')).toBeNull();
    });
});
