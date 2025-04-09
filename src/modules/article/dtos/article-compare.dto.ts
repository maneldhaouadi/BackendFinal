import { ApiProperty } from '@nestjs/swagger';
import { ResponseArticleDto } from './article.response.dto';

export class ArticleCompareResponseDto {
  @ApiProperty({
    description: 'Les différences entre l\'article et l\'image',
    example: {
      title: {
        oldValue: 'Ancien titre',
        newValue: 'Nouveau titre'
      },
      salePrice: {
        oldValue: 100,
        newValue: 120
      }
    }
  })
  differences: Record<string, { oldValue: any; newValue: any }>;
  
  @ApiProperty({ 
    description: 'Données extraites de l\'image',
    type: Object
  })
  ocrData: any;
  
  @ApiProperty({ 
    description: 'Indique si des différences ont été trouvées',
    type: Boolean
  })
  hasDifferences: boolean;
  
  @ApiProperty({ 
    description: 'Article existant',
    type: ResponseArticleDto
  })
  article: ResponseArticleDto;
}