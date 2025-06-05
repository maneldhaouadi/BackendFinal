import { ApiProperty } from '@nestjs/swagger';
import { Column } from 'typeorm';

export class CreateArticleHistoryDto {
  @ApiProperty({ 
    example: 2, 
    description: 'Numéro de version incrémenté', 
    required: true 
  })
  version: number;

  @ApiProperty({
    example: { 
      status: { 
        oldValue: 'active', 
        newValue: 'inactive' 
      },
      quantityInStock: {
        oldValue: 100,
        newValue: 95
      }
    },
    description: 'Dictionnaire des modifications avec anciennes et nouvelles valeurs',
    required: true,
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        oldValue: { type: 'any', description: 'Valeur avant modification' },
        newValue: { type: 'any', description: 'Valeur après modification' }
      }
    }
  })
  changes: Record<string, { oldValue: any; newValue: any }>;

    @Column('json') // Nouveau champ pour le snapshot complet
    snapshot: Record<string, any>;

  @ApiProperty({ 
    example: 1, 
    description: 'ID de l\'article concerné', 
    required: true 
  })
  articleId: number;
}