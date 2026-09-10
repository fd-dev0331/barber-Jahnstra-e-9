/* Wer darf welche Leistung ausführen?

   employee_service ist eine Whitelist JE LEISTUNG: stehen für eine Leistung keine
   Einträge in der Tabelle, darf sie jeder aktive Mitarbeiter ausführen; sonst nur
   die eingetragenen (so filtert api/employees.js die Buchungsseite).

   Die API speichert die Zuordnung je Mitarbeiter (PATCH /employees/:id mit
   serviceIds). Diese Helfer rechnen eine gewünschte Zuordnung je Leistung in
   genau die Mitarbeiter-Änderungen um, die dafür nötig sind. */

/** Set der eingetragenen Mitarbeiter-IDs oder null (= alle aktiven). */
export function whitelist(serviceId, employees) {
  const ids = employees.filter((e) => e.serviceIds.includes(serviceId)).map((e) => e.id);
  return ids.length ? new Set(ids) : null;
}

export function canPerform(employee, serviceId, employees) {
  const allowed = whitelist(serviceId, employees);
  return !allowed || allowed.has(employee.id);
}

/** Umfasst die Auswahl alle aktiven Mitarbeiter, braucht es keine Einträge (null). */
export function normalizeSelection(selectedIds, employees) {
  const active = employees.filter((e) => e.status === 'ACTIVE').map((e) => e.id);
  return active.length && active.every((id) => selectedIds.has(id)) ? null : selectedIds;
}

/**
 * desired: Map<serviceId, Set<employeeId> | null>
 * Ergebnis: [{ id, serviceIds }] nur für Mitarbeiter, deren Liste sich ändert.
 */
export function planAssignments(employees, desired) {
  const changes = [];
  for (const employee of employees) {
    const next = new Set(employee.serviceIds.filter((id) => !desired.has(id)));
    for (const [serviceId, selected] of desired) {
      if (selected && selected.has(employee.id)) next.add(serviceId);
    }
    const before = new Set(employee.serviceIds);
    const changed = next.size !== before.size || [...next].some((id) => !before.has(id));
    if (changed) changes.push({ id: employee.id, serviceIds: [...next] });
  }
  return changes;
}
