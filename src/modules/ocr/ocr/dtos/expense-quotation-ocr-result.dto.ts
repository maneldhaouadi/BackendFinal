import { ApiProperty } from '@nestjs/swagger';

// Interface pour les valeurs extraites avec confiance
export interface IFieldValue<T = any> {
  value: T;
  confidence: number;
}

// Type pour les données structurées de la facture
export type ExpenseQuotationData = Record<string, IFieldValue>;

// Journal de correction
export class CorrectionLog {
  @ApiProperty({ example: 'refzerenec', description: 'Texte original avant correction' })
  original: string;

  @ApiProperty({ example: 'référence', description: 'Texte corrigé' })
  corrected: string;

  @ApiProperty({ example: 0.95, description: 'Score de confiance de la correction (0-1)' })
  confidence: number;

  @ApiProperty({ 
    example: 'reference', 
    description: 'Nom du champ où la correction a été appliquée',
    required: false 
  })
  field?: string;

  @ApiProperty({ 
    example: ['semantic-correction'], 
    description: 'Contexte de la correction',
    required: false 
  })
  context?: string[];
}

// Résultat de reconnaissance de champ
export class FieldRecognitionResult {
  @ApiProperty({ example: 'reference', description: 'Nom du champ reconnu' })
  fieldName: string;

  @ApiProperty({ example: 0.95, description: 'Score de confiance (0-1)' })
  confidence: number;

  @ApiProperty({ 
    example: ['référence', 'ref'], 
    description: 'Synonymes reconnus pour ce champ' 
  })
  synonyms: string[];

  @ApiProperty({
    description: 'Résultats de correspondance de motifs',
    example: {
      matched: true,
      pattern: 'Référence: PROD-2024-789',
      priority: 1,
      matchedText: 'Reference: PROD-2024-789',
      confidenceBoost: 0.3
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

// Réponse principale OCR
export class ExpenseQuotationOcrResponse {
  @ApiProperty({ 
    example: true, 
    description: 'Indique si le traitement a réussi' 
  })
  success: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        value: { type: 'any' },
        confidence: { type: 'number' }
      }
    },
    example: {
      reference: { value: "DEV-2024-123", confidence: 0.98 },
      total: { value: 1547.89, confidence: 0.97 },
      date: { value: "2024-03-15", confidence: 0.96 }
    },
    description: 'Données structurées extraites'
  })
  data: ExpenseQuotationData;

  @ApiProperty({ 
    type: [FieldRecognitionResult], 
    description: 'Détails de reconnaissance des champs',
    required: false 
  })
  recognitionDetails?: FieldRecognitionResult[];

  @ApiProperty({ 
    type: [CorrectionLog], 
    description: 'Corrections appliquées pendant le traitement',
    required: false 
  })
  corrections?: CorrectionLog[];

  @ApiProperty({ 
    example: 92.5, 
    description: 'Score de confiance global (0-100)' 
  })
  confidence: number;

  @ApiProperty({ 
    example: 3450, 
    description: 'Temps de traitement en millisecondes' 
  })
  processingTime: number;

  @ApiProperty({ 
    example: "Document traité avec succès", 
    description: 'Message de statut' 
  })
  message: string;

  @ApiProperty({
    required: false,
    description: 'Informations de débogage',
    example: {
      ocrText: "Reference: DEV-2024-123\nTotal: 1547.89€\nDate: 15/03/2024",
      preProcessedText: "reference dev-2024-123 total 1547.89 date 2024-03-15",
      correctedText: "référence: DEV-2024-123\nmontant: 1547.89€\ndate: 2024-03-15",
      warnings: ["Confiance faible sur le champ date"]
    }
  })
  debug?: {
    ocrText?: string;
    preProcessedText?: string;
    correctedText?: string;
    warnings?: string[];
  };
}

// Alias pour compatibilité
export interface OcrProcessResponse extends ExpenseQuotationOcrResponse {}
export const OcrProcessResponse = ExpenseQuotationOcrResponse;