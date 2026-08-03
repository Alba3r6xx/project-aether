/**
 * Tiny classnames helper - joins truthy class strings and skips falsy values.
 * Kept dependency-free since the project only needs simple conditionals.
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
