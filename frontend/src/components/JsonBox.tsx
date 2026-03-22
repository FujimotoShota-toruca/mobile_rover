import { useState } from "react";

type Props = {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
};

export function JsonBox({ label, value, onChange, readOnly = false }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="card stack-gap">
      <div className="row-between">
        <strong>{label}</strong>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch (error) {
              console.error(error);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea
        className="json-box"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
      />
    </div>
  );
}
