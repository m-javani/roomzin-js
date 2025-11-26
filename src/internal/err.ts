import { RoomzinError, ErrorKind } from '../types/err';

type Stringable = string | Error | { toString(): string };

/**
 * RzError turns *anything* into a RoomzinError.
 *   RzError('AUTH_ERROR:bad token')            -> KindClient
 *   RzError(new Error('VALIDATION_ERROR:foo')) -> KindRequest
 *   RzError('something else')                  -> KindInternal
 *   RzError(any, ErrorKind.Retry)              -> forced bucket
 *
 * Drop-in replacement for `new Error(...)` everywhere.
 */
export function RzError(input: Stringable, kind?: ErrorKind): RoomzinError {
    if (input instanceof RoomzinError) return input;   // already wrapped

    const str = input instanceof Error ? input.message : String(input);
    const [code = 'INTERNAL_ERROR', msg = str] = str.split(':', 2);

    if (kind) return new RoomzinError(kind, code, msg);

    switch (code) {
        case 'AUTH_ERROR':
            return new RoomzinError(ErrorKind.Client, code, msg);
        case 'VALIDATION_ERROR':
        case 'NOT_FOUND':
        case 'OVERFLOW':
        case 'UNDERFLOW':
        case 'FORBIDDEN':
            return new RoomzinError(ErrorKind.Request, code, msg);
        case '503':
        case '429':
        case '308':
        case '405':
            return new RoomzinError(ErrorKind.Retry, code, msg);
        default:
            return new RoomzinError(ErrorKind.Internal, code || 'INTERNAL_ERROR', msg);
    }
}