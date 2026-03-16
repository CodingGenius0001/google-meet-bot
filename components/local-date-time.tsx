"use client";

import { useEffect, useState } from "react";

type LocalDateTimeProps = {
  value: Date | string | null | undefined;
  emptyLabel?: string;
  timeOnly?: boolean;
};

function formatValue(value: Date | string, timeOnly: boolean) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    ...(timeOnly ? {} : { dateStyle: "medium" }),
    timeStyle: "short",
    timeZoneName: "short"
  }).format(date);
}

export function LocalDateTime({
  value,
  emptyLabel = "Not available",
  timeOnly = false
}: LocalDateTimeProps) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setFormatted(null);
      return;
    }

    setFormatted(formatValue(value, timeOnly));
  }, [timeOnly, value]);

  if (!value) {
    return <span>{emptyLabel}</span>;
  }

  return <span suppressHydrationWarning>{formatted ?? "..."}</span>;
}
