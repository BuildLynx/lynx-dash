// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef } from "react";

import JsonInput from "@lichtblick/suite-base/components/JsonInput";

export type JsonPayloadEditorProps = {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onCustomizedChange: (customized: boolean) => void;
  readOnly?: boolean;
};

export function JsonPayloadEditor(props: JsonPayloadEditorProps): React.JSX.Element {
  const { value, onChange, onCustomizedChange, readOnly = false } = props;
  const suppressCustomizedRef = useRef(false);

  useEffect(() => {
    suppressCustomizedRef.current = true;
  }, [value]);

  const handleChange = useCallback(
    (obj: unknown) => {
      if (suppressCustomizedRef.current) {
        suppressCustomizedRef.current = false;
      } else {
        onCustomizedChange(true);
      }
      if (obj != undefined && typeof obj === "object" && !Array.isArray(obj)) {
        onChange(obj as Record<string, unknown>);
      } else if (Array.isArray(obj)) {
        onChange({ items: obj });
      }
    },
    [onChange, onCustomizedChange],
  );

  return <JsonInput value={value} onChange={handleChange} readOnly={readOnly} />;
}
