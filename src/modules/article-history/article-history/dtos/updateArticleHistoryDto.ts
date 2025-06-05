import { ApiProperty } from '@nestjs/swagger';

export class UpdateArticleHistoryDto {
  @ApiProperty({ 
    example: 3, 
    description: 'Nouveau numéro de version (optionnel)', 
    required: false 
  })
  version?: number;

  @ApiProperty({
    example: {
      status: {
        oldValue: 'inactive',
        newValue: 'active'
      }
    },
    description: 'Modifications supplémentaires à enregistrer (optionnel)',
    required: false,
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        oldValue: { type: 'any' },
        newValue: { type: 'any' }
      }
    }
  })
  changes?: Record<string, { oldValue: any; newValue: any }>;
}