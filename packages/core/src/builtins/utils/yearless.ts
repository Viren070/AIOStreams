/** Remove only the appended movie year, preserving numeric titles and query limits. */
export function getYearlessQueries(queries: string[], year: number): string[] {
  const suffix = ` ${year}`;
  return [
    ...new Set(
      queries
        .filter((query) => query.endsWith(suffix))
        .map((query) => query.slice(0, -suffix.length).trim())
        .filter((query) => query.length > 0 && !queries.includes(query))
    ),
  ];
}
