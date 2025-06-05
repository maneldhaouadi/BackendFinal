import { ApiProperty } from '@nestjs/swagger';

export class ResponseArticleHistoryDto {
  @ApiProperty({ 
    example: 1, 
    description: 'ID unique de l\'entrée d\'historique' 
  })
  id: number;

  @ApiProperty({ 
    example: 2, 
    description: 'Numéro de version de l\'article' 
  })
  version: number;

  @ApiProperty({
    example: {
      title: {
        oldValue: 'Produit A',
        newValue: 'Produit A (Nouveau)'
      },
      price: {
        oldValue: 10.99,
        newValue: 12.99
      }
    },
    description: 'Détail des modifications pour cette version',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        oldValue: { type: 'any' },
        newValue: { type: 'any' }
      }
    }
  })
  changes: Record<string, { oldValue: any; newValue: any }>;

  @ApiProperty({
    example: {
      id: 1,
      title: 'Produit A (Nouveau)',
      description: 'Description mise à jour',
      reference: 'REF-001',
      quantityInStock: 50,
      status: 'active',
      unitPrice: 12.99,
      version: 2
    },
    description: 'Snapshot complet de l\'article à cette version'
  })
  snapshot: Record<string, any>;

  @ApiProperty({ 
    example: '2023-10-01T12:00:00.000Z', 
    description: 'Date et heure de la modification' 
  })
  date: Date;

  @ApiProperty({ 
    example: true, 
    description: 'Indique si cette version est la version active actuelle' 
  })
  isActive: boolean;

  @ApiProperty({ 
    example: 1, 
    description: 'ID de l\'article associé' 
  })
  articleId: number;
}