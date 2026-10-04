import type { AggregationStage } from "@/shared/store";
import { goCode, javaCode, nodeCode, pythonCode } from "./languages";
import type { CodeInput } from "./values";

export type DriverLang = "node" | "python" | "java" | "go";

export const DRIVER_LANGS: { lang: DriverLang; label: string }[] = [
  { lang: "node", label: "Node.js" },
  { lang: "python", label: "Python (PyMongo)" },
  { lang: "java", label: "Java" },
  { lang: "go", label: "Go" },
];

const GENERATORS: Record<DriverLang, (input: CodeInput) => string> = {
  node: nodeCode,
  python: pythonCode,
  java: javaCode,
  go: goCode,
};

/** The composed stages next to the titles and notes of the enabled main
 *  cards they came from. */
export function codeInput(
  canonical: unknown[],
  collection: string,
  stages: AggregationStage[],
): CodeInput {
  const cards = stages.filter((s) => s.enabled);
  const paired = cards.length === canonical.length;
  return {
    collection,
    stages: canonical.map((stage, i) => {
      const card = paired ? cards[i] : null;
      const title = card?.title?.trim();
      const note = card?.note?.trim();
      return {
        stage,
        comments: [
          ...(title ? [title] : []),
          ...(note ? note.split("\n") : []),
        ],
      };
    }),
  };
}

export function driverCode(lang: DriverLang, input: CodeInput): string {
  return GENERATORS[lang](input);
}
