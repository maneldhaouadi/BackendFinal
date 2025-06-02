import { ApiProperty } from '@nestjs/swagger';

export class CorrectionLog {
  @ApiProperty({ example: 'montant', description: 'Original text before correction' })
  original: string;

  @ApiProperty({ example: 'amount', description: 'Corrected text' })
  corrected: string;

  @ApiProperty({ example: 0.95, description: 'Confidence score of the correction' })
  confidence: number;

  @ApiProperty({ 
    example: 'amount', 
    description: 'Field name where correction was applied',
    required: false 
  })
  field?: string;

  @ApiProperty({
    type: [String],
    example: ['semantic-correction'],
    description: 'Context of the correction',
    required: false
  })
  context?: string[];
}

export class FieldRecognitionResult {
  @ApiProperty({ example: 'amount', description: 'Name of the recognized field' })
  fieldName: string;

  @ApiProperty({ example: 0.95, description: 'Confidence score (0-1)' })
  confidence: number;

  @ApiProperty({ 
    type: [String],
    example: ['montant', 'total'],
    description: 'Recognized synonyms for this field'
  })
  synonyms: string[];

  @ApiProperty({
    type: 'object',
    description: 'Pattern matching results',
    properties: {
      matched: { type: 'boolean', example: true },
      pattern: { type: 'string', example: 'Montant: 1500.00 EUR' },
      priority: { type: 'number', example: 1 },
      matchedText: { type: 'string', example: 'Montant: 1500.00 EUR'},
      confidenceBoost: { type: 'number', example: 0.3}
    }
  })
  patterns: {
    matched: boolean;
    pattern: string;
    priority: number;
    matchedText?: string;
    confidenceBoost?: number;
  }[];
}

export class PaymentOcrProcessResponse {
  @ApiProperty({ 
    example: true, 
    description: 'Indicates if processing was successful' 
  })
  success: boolean;

  @ApiProperty({
    example: {
      amount: { value: "1500.00", confidence: 98 },
      date: { value: "2023-05-15", confidence: 92 },
      reference: { value: "PAY-2023-456", confidence: 85 }
    },
    description: 'Extracted payment data',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        value: { type: 'any' },
        confidence: { type: 'number' }
      }
    }
  })
  data: Record<string, { value: any; confidence: number }>;

  @ApiProperty({ 
    type: [FieldRecognitionResult],
    description: 'Detailed field recognition results',
    required: false
  })
  recognitionDetails?: FieldRecognitionResult[];

  @ApiProperty({ 
    type: [CorrectionLog],
    example: [
      {
        original: "montant",
        corrected: "amount",
        confidence: 0.95,
        field: "amount",
        context: ["semantic-correction"]
      }
    ],
    description: 'List of corrections applied during OCR processing',
    required: false
  })
  corrections?: CorrectionLog[];

  @ApiProperty({ 
    example: 92.5, 
    description: 'Overall confidence score (0-100)' 
  })
  confidence: number;

  @ApiProperty({ 
    example: 3450,
    description: 'Processing time in milliseconds',
    required: false 
  })
  processingTime?: number;

  @ApiProperty({
    example: "Payment processed successfully",
    description: 'Status message',
    required: false
  })
  message?: string;

  @ApiProperty({
    required: false,
    description: 'Debug information when debug mode is enabled',
    type: 'object',
    properties: {
      ocrText: { type: 'string', description: 'Raw OCR output text' },
      preProcessedText: { type: 'string', description: 'Text after preprocessing' },
      correctedText: { type: 'string', description: 'Text after field name correction' },
      warnings: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Warning messages' 
      }
    }
  })
  debug?: {
    ocrText?: string;
    preProcessedText?: string;
    correctedText?: string;
    warnings?: string[];
  };
}