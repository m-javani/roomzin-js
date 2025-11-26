export type Codecs = {
    rateFeatures: string[];
};

export function validateRateFeatures(codecs: Codecs, input: string[]): [boolean, string] {
    const invalid: string[] = [];

    for (const rate of input) {
        if (!codecs.rateFeatures.includes(rate)) {
            invalid.push(rate);
        }
    }

    if (invalid.length > 0) {
        return [false, "Invalid rate features: " + invalid.join(", ")];
    }
    return [true, ""];
}