import Ajv from 'ajv';
import { DomainError, idPattern } from './domain.mjs';

export const canvasAnnotationKinds = ['note', 'text', 'reference'];
export const canvasAnnotationTones = ['gold', 'blue', 'rose', 'neutral'];

const position = {
  type: 'object', additionalProperties: false, required: ['x', 'y'],
  properties: {
    x: { type: 'number', minimum: -100000, maximum: 100000 },
    y: { type: 'number', minimum: -100000, maximum: 100000 },
  },
};
const text = { type: 'string', maxLength: 12000 };
const editableFields = kind => kind === 'reference' ? {
  assetId: { type: 'string', pattern: idPattern },
  title: { type: 'string', maxLength: 160 },
  description: text,
  position,
} : {
  text,
  tone: { enum: canvasAnnotationTones },
  position,
};
const ajv = new Ajv({ allErrors: true, strict: false });
const createValidators = new Map(canvasAnnotationKinds.map(kind => [kind, ajv.compile({
  type: 'object', additionalProperties: false,
  required: kind === 'reference' ? ['kind', 'assetId'] : ['kind'],
  properties: { kind: { const: kind }, ...editableFields(kind) },
})]));
const patchValidators = new Map(canvasAnnotationKinds.map(kind => [kind, ajv.compile({
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: editableFields(kind),
})]));

export function validateCanvasAnnotationInput(input, { kind = input?.kind, patch = false, assetIds = [] } = {}) {
  const validate = (patch ? patchValidators : createValidators).get(kind);
  if (!validate || !validate(input)) {
    throw new DomainError('畫布註記格式不正確，請檢查文字、色調與位置。', 422, 'INVALID_CANVAS_ANNOTATION', validate?.errors?.map(error => ({ path: error.instancePath || '/', message: error.message, field: error.params.missingProperty })));
  }
  if (kind === 'reference' && Object.hasOwn(input, 'assetId') && !assetIds.includes(input.assetId)) {
    throw new DomainError('畫布參考圖必須引用這個專案中已匯入的圖片。', 422, 'UNKNOWN_ASSET');
  }
  return structuredClone(input);
}

export function canvasAnnotationDefaults(input) {
  return input.kind === 'reference'
    ? { title: '', description: '', position: { x: 0, y: 0 }, ...input }
    : { text: '', tone: 'gold', position: { x: 0, y: 0 }, ...input };
}
