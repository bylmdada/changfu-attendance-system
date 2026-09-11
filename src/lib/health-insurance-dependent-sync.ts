type HealthInsuranceDependentCountClient = {
  healthInsuranceDependent?: {
    count?: (args: { where: { employeeId: number; isActive: boolean } }) => Promise<number>;
  };
};

type EmployeeDependentsUpdateClient = HealthInsuranceDependentCountClient & {
  employee?: {
    update?: (args: { where: { id: number }; data: { dependents: number } }) => Promise<unknown>;
  };
};

function normalizeDependentCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

export async function countActiveHealthInsuranceDependents(
  client: HealthInsuranceDependentCountClient,
  employeeId: number,
  fallbackDependents = 0
) {
  if (!client.healthInsuranceDependent?.count) {
    return normalizeDependentCount(fallbackDependents);
  }

  return client.healthInsuranceDependent.count({
    where: {
      employeeId,
      isActive: true,
    },
  });
}

export async function syncEmployeeDependentsCount(
  client: EmployeeDependentsUpdateClient,
  employeeId: number,
  fallbackDependents = 0
) {
  const activeDependentCount = await countActiveHealthInsuranceDependents(
    client,
    employeeId,
    fallbackDependents
  );

  if (!client.employee?.update) {
    return activeDependentCount;
  }

  await client.employee.update({
    where: { id: employeeId },
    data: { dependents: activeDependentCount },
  });

  return activeDependentCount;
}
