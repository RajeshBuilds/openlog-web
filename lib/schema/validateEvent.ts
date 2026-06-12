import { Ajv, type ValidateFunction } from "ajv";

import baseSchema from "./rr-mobile-schema.json";

/**
 * Validates a single rr-mobile event against the wire contract with the
 * Android SDK.
 *
 * The base schema is vendored verbatim from PostHog (MIT,
 * rr-mobile-schema.json). OpenLog deliberately relaxes it in one way:
 * every `additionalProperties: false` is flipped to `true`, because the
 * OpenLog SDK extends events with its own fields (e.g. `className` and
 * `idName` on wireframes for the web UI) and the contract should tolerate
 * future additions without a schema redeploy. Required fields, types, and
 * event structure are still enforced as-is.
 */

function relaxAdditionalProperties(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) relaxAdditionalProperties(item);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.additionalProperties === false) obj.additionalProperties = true;
    for (const value of Object.values(obj)) relaxAdditionalProperties(value);
  }
}

function buildSchema(): object {
  const schema = structuredClone(baseSchema) as Record<string, unknown>;
  relaxAdditionalProperties(schema);
  return schema;
}

let compiled: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: false, strict: false });
    compiled = ajv.compile(buildSchema());
  }
  return compiled;
}

export interface EventValidation {
  valid: boolean;
  /** Human-readable reason for the first failure, if any. */
  error?: string;
}

export function validateEvent(event: unknown): EventValidation {
  const validate = getValidator();
  if (validate(event)) return { valid: true };
  const first = validate.errors?.[0];
  return {
    valid: false,
    error: first ? `${first.instancePath || "/"} ${first.message}` : "unknown validation error",
  };
}
