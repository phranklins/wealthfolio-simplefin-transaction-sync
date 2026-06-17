import { Alert, AlertDescription } from "@wealthfolio/ui";

/**
 * A simple alert component that displays a list of errors.
 */

export function SfErrorsAlert({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription>
        <p className="font-medium mb-1">SimpleFin reported errors:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
