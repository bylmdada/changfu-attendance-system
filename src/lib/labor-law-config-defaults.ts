export interface LaborLawConfigValues {
  basicWage: number;
  laborInsuranceRate: number;
  laborInsuranceMax: number;
  laborEmployeeRate: number;
}

export const DEFAULT_LABOR_LAW_CONFIG: LaborLawConfigValues = {
  basicWage: 29500,
  laborInsuranceRate: 0.115,
  laborInsuranceMax: 45800,
  laborEmployeeRate: 0.2,
};
