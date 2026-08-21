import { formatCell, Row, unwrapRows } from '../results/rows';

export interface VariableRow {
    name: string;
    type: string;
    required: boolean;
    description: string;
    shape: string;
}

/**
 * Parse CLI JSON stdout, treating blank / whitespace / `(no items)` as empty.
 */
export function parseSuccessfulJson(stdout: string): unknown | undefined {
    const text = stdout.trim();
    if (!text || text === '(no items)') {
        return undefined;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error('could not parse JSON from CLI output');
    }
}

export function toVariableRows(raw: unknown): VariableRow[] {
    return unwrapRows(raw)
        .map(toVariableRow)
        .filter((row): row is VariableRow => row !== undefined);
}

function toVariableRow(row: Row): VariableRow | undefined {
    const name = stringField(row, 'name') || stringField(row, 'Name');
    if (!name) {
        return undefined;
    }

    return {
        name,
        type: stringField(row, 'type') || stringField(row, 'Type') || 'string',
        required: Boolean(row.required ?? row.Required),
        description: stringField(row, 'description') || stringField(row, 'Description'),
        shape: stringField(row, 'shape') || stringField(row, 'Shape'),
    };
}

export function formatRequired(required: boolean): string {
    return required ? 'required' : 'optional';
}

export function formatVariableLabel(row: VariableRow): string {
    const bits = [row.type, formatRequired(row.required)];
    if (row.shape) {
        bits.push(row.shape);
    }
    return bits.join(' · ');
}

function stringField(row: Row, key: string): string {
    const value = row[key];
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
        return formatCell(value);
    }
    return value == null ? '' : String(value);
}
