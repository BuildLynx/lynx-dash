// SPDX-License-Identifier: MPL-2.0

import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import { memo, useCallback, useMemo } from "react";

import type { JsonSchema } from "@lichtblick/suite-base/lynx/types";

/**
 * Normalize a Lynx payload schema into a form that RJSF can render.
 *
 * Lynx endpoints may provide just the properties map (no root `type`/`properties` wrapper)
 * and may use JSON Schema array-style `type` values (e.g. `["object","boolean"]`) which
 * RJSF does not support.
 */
function normalizeSchema(raw: JsonSchema): JsonSchema {
  const clone = JSON.parse(JSON.stringify(raw) as string) as Record<string, unknown>;

  function normalizeTypeField(obj: Record<string, unknown>): void {
    if (Array.isArray(obj.type)) {
      const types = (obj.type as unknown[]).filter((t) => t !== "null") as string[];
      obj.type = types[0] ?? "object";
    }
    if (typeof obj.properties === "object" && obj.properties != null) {
      for (const prop of Object.values(obj.properties as Record<string, unknown>)) {
        if (typeof prop === "object" && prop != null) {
          normalizeTypeField(prop as Record<string, unknown>);
        }
      }
    }
  }

  if (clone.type == null && clone.properties == null) {
    const wrapped: Record<string, unknown> = { type: "object", properties: clone };
    normalizeTypeField(wrapped);
    return wrapped as JsonSchema;
  }

  normalizeTypeField(clone);
  return clone as JsonSchema;
}

export type SchemaFormProps = {
  schema: JsonSchema;
  formData: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
};

function SchemaFormComponent(props: SchemaFormProps): React.JSX.Element {
  const { schema, formData, onChange } = props;

  const normalizedSchema = useMemo(() => normalizeSchema(schema), [schema]);

  const handleChange = useCallback(
    (e: { formData?: unknown }) => {
      if (e.formData != undefined && typeof e.formData === "object" && !Array.isArray(e.formData)) {
        onChange(e.formData as Record<string, unknown>);
      }
    },
    [onChange],
  );

  return (
    <Form
      schema={normalizedSchema}
      formData={formData}
      validator={validator}
      liveValidate={false}
      omitExtraData
      onChange={handleChange}
    >
      {/* Hide default submit button — parent SendSection has its own */}
      <></>
    </Form>
  );
}

export const SchemaForm = memo(SchemaFormComponent);
