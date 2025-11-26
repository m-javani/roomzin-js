export enum ErrorKind {
    Client = 'CLIENT',
    Request = 'REQUEST',
    Internal = 'INTERNAL',
    Retry = 'RETRY',
}

export class RoomzinError extends Error {
    public readonly kind: ErrorKind;
    public readonly code: string;

    constructor(kind: ErrorKind, code: string, message: string) {
        super(`${code}:${message}`);   // same string format as Go
        this.name = 'RoomzinError';
        this.kind = kind;
        this.code = code;
        Object.setPrototypeOf(this, RoomzinError.prototype); // instanceof works across realms
    }

    /* allow  errors.is(err, RoomzinError.Client)  usage */
    static readonly Client = new RoomzinError(ErrorKind.Client, 'CLIENT_ERROR', '');
    static readonly Request = new RoomzinError(ErrorKind.Request, 'REQUEST_ERROR', '');
    static readonly Internal = new RoomzinError(ErrorKind.Internal, 'INTERNAL_ERROR', '');
    static readonly Retry = new RoomzinError(ErrorKind.Retry, 'RETRY_ERROR', '');
}

/* ---------- user-facing helpers ---------- */
export const IsClient = (e: any): e is RoomzinError => isKind(e, ErrorKind.Client);
export const IsRequest = (e: any): e is RoomzinError => isKind(e, ErrorKind.Request);
export const IsInternal = (e: any): e is RoomzinError => isKind(e, ErrorKind.Internal);
export const IsRetry = (e: any): e is RoomzinError => isKind(e, ErrorKind.Retry);

function isKind(err: any, want: ErrorKind): boolean {
    return err instanceof RoomzinError && err.kind === want;
}