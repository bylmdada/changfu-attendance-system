export const PROPERTY_EDITABLE_FIELDS = [
  'name',
  'location',
  'managerName',
  'maintenanceFrequency',
  'nextMaintenanceDate',
  'photoPath',
] as const;

export type PropertyEditableField = (typeof PROPERTY_EDITABLE_FIELDS)[number];

export const PROPERTY_FIELD_LABEL: Record<PropertyEditableField, string> = {
  name: '財產名稱',
  location: '放置地點',
  managerName: '財產管理人',
  maintenanceFrequency: '應維護頻率',
  nextMaintenanceDate: '應維護日期',
  photoPath: '財產照片',
};
