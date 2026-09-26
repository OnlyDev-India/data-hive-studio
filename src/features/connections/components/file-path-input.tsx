import { FolderOpen } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { pickCertFilePath } from "@/shared/lib/platform";

/** A path text field with a native "browse" button living inside the
 *  field itself (shadcn's Input Group pattern) — the path is still
 *  typeable by hand (e.g. pasting one in from elsewhere), the button just
 *  saves reaching for a terminal to find it. */
export function FilePathInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  async function browse() {
    const path = await pickCertFilePath();
    if (path) onChange(path);
  }

  return (
    <InputGroup>
      <InputGroupInput
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          title="Browse for file"
          disabled={disabled}
          onClick={() => void browse()}
        >
          <FolderOpen />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
