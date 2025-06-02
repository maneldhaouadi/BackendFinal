import { ApiProperty } from '@nestjs/swagger';

export class InvoiceCorrectionLog {
  @ApiProperty({ example: 'montanttt', description: 'Original text before correction' })
  original: string;

  @ApiProperty({ example: 'montant', description: 'Corrected text' })
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

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Timestamp of the correction',
    required: false
  })
  timestamp?: Date;
}

export class InvoiceFieldRecognitionResult {
  @ApiProperty({ example: 'invoice_number', description: 'Name of the recognized field' })
  fieldName: string;

  @ApiProperty({ example: 0.95, description: 'Confidence score (0-1)' })
  confidence: number;

  @ApiProperty({ 
    type: [String],
    example: ['numéro de facture', 'facture no'],
    description: 'Recognized synonyms for this field'
  })
  synonyms: string[];

  @ApiProperty({
    type: 'object',
    description: 'Pattern matching results',
    properties: {
      matched: { type: 'boolean', example: true },
      pattern: { type: 'string', example: 'Facture No: INV-2024-789' },
      priority: { type: 'number', example: 1 },
      matchedText: { type: 'string', example: 'Facture No: INV-2024-789'},
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

export class InvoiceOcrProcessResponse {
  @ApiProperty({ 
    example: true, 
    description: 'Indicates if processing was successful' 
  })
  success: boolean;

  @ApiProperty({
    example: {
      invoice_number: { value: "INV-2024-789", confidence: 98 },
      invoice_date: { value: "2024-05-01", confidence: 92 },
      due_date: { value: "2024-06-01", confidence: 85 },
      total_amount: { value: 1250.99, confidence: 95 }
    },
    description: 'Extracted invoice data',
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
    type: [InvoiceFieldRecognitionResult],
    description: 'Detailed field recognition results',
    required: false
  })
  recognitionDetails?: InvoiceFieldRecognitionResult[];

  @ApiProperty({ 
    type: [InvoiceCorrectionLog],
    example: [
      {
        original: "montanttt",
        corrected: "montant",
        confidence: 0.95,
        field: "total_amount",
        context: ["semantic-correction"]
      }
    ],
    description: 'List of corrections applied during OCR processing',
    required: false
  })
  corrections?: InvoiceCorrectionLog[];

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
    example: "File processed successfully",
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