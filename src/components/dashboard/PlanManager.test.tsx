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
    onDuplicateActive: ReturnType<typeof vi.fn<() => void>>;
    onNewPlanGuided: ReturnType<typeof vi.fn<() => void>>;
    onActivate: ReturnType<typeof vi.fn<(id: string) => void>>;
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
        onDuplicateActive: vi.fn<() => void>(),
        onNewPlanGuided: vi.fn<() => void>(),
        onActivate: vi.fn<(id: string) => void>(),
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

    it('calls onNewPlanGuided when New Plan is clicked', async () => {
        const user = userEvent.setup();
        const { onNewPlanGuided } = renderManager({ plans: [makePlan()] });

        await user.click(screen.getByRole('button', { name: 'New Plan' }));

        expect(onNewPlanGuided).toHaveBeenCalledTimes(1);
    });

    it('calls onDuplicateActive when Duplicate Plan is clicked', async () => {
        const user = userEvent.setup();
        const { onDuplicateActive } = renderManager({ plans: [makePlan()] });

        await user.click(screen.getByRole('button', { name: 'Duplicate Plan' }));

        expect(onDuplicateActive).toHaveBeenCalledTimes(1);
    });

    it('activates on row click; the delete button opens a confirm dialog without activating or deleting', async () => {
        const user = userEvent.setup();
        const a = makePlan({ name: 'Plan A' });
        const b = makePlan({ name: 'Plan B' });
        const { onActivate, onDelete } = renderManager({ plans: [a, b], activePlanId: a.id });

        // Row click on the inactive plan activates it.
        await user.click(screen.getByText('Plan B'));
        expect(onActivate).toHaveBeenCalledWith(b.id);

        onActivate.mockClear();

        // Delete on Plan B: opens the confirm dialog, no activation, no delete yet.
        const delButtons = screen.getAllByRole('button', { name: 'Delete plan' });
        await user.click(delButtons[1]);
        expect(onActivate).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Delete plan?');
        expect(dialog).toHaveTextContent('Plan B');
    });

    it('delete then Cancel does not delete; delete then Delete calls onDelete with the row id', async () => {
        const user = userEvent.setup();
        const a = makePlan({ name: 'Plan A' });
        const b = makePlan({ name: 'Plan B' });
        const { onDelete } = renderManager({ plans: [a, b], activePlanId: a.id });

        // Open confirm for Plan B, then Cancel — nothing deleted, dialog closes.
        await user.click(screen.getAllByRole('button', { name: 'Delete plan' })[1]);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();

        // Open again and confirm — onDelete fires with Plan B's id.
        await user.click(screen.getAllByRole('button', { name: 'Delete plan' })[1]);
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onDelete).toHaveBeenCalledWith(b.id);
    });

    it('Share opens a dialog showing the copyable link', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

        renderManager({ plans: [makePlan({ name: 'Plan A' })] });

        await user.click(screen.getByRole('button', { name: /Share/ }));

        // Clipboard write attempted; success dialog shown with the URL in a field.
        expect(writeText).toHaveBeenCalledTimes(1);
        const urlWritten = writeText.mock.calls[0][0];
        expect(urlWritten).toContain('#start=');

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Share link copied');
        expect(screen.getByLabelText('Share link')).toHaveValue(urlWritten);
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
        expect(screen.getByRole('button', { name: /Compare Plans/ })).toBeDisabled();
        expect(screen.getByText('Create a second plan to compare')).toBeInTheDocument();

        cleanup();

        renderManager({ plans: [makePlan(), makePlan()] });
        expect(screen.getByRole('button', { name: /Compare Plans/ })).toBeEnabled();
        expect(screen.queryByText('Create a second plan to compare')).toBeNull();
    });
});
