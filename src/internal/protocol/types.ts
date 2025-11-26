export const ErrConnClosed = new Error("connection closed");
export const ErrTimeout = new Error("request timed out");
export const ErrShortFrame = new Error("incomplete frame");
export const ErrMissingMagic = new Error("missing magic byte");

export type Header = {
    clrID: number;
    status: string; // "SUCCESS" or "ERROR"
    fieldCnt: number; // number of fields that follow
};

export type Field = {
    id: number;
    fieldType: number;
    data: Buffer;
};

// Add this missing type
export type RawResult = {
    status: string;
    fields: Field[];
};