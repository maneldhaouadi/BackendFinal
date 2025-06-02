// article-stats.response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ArticleStatsResponseDto {
  @ApiProperty({ example: 150 })
  totalArticles: number;

  @ApiProperty({ example: { active: 70, draft: 30, archived: 20 } })
  statusDistribution: Record<string, number>;

  @ApiProperty({ example: { active: '46.67%', draft: '20%', archived: '13.33%' } })
  statusPercentages: Record<string, string>;

  @ApiProperty({ example: 15 })
  outOfStockCount: number;

  @ApiProperty({ example: 1250 })
  totalStockAvailable: number;

  @ApiProperty({ example: 8.33 })
  averageStockPerArticle: number;

  @ApiProperty({ example: 25 })
  lowStockCount: number;

  @ApiProperty({ example: { 'A123': 15, 'B456': 30 } })
  outOfStockSinceDays: Record<string, number>;

  @ApiProperty({ 
    example: [
      { reference: 'TOP1', value: 5000 },
      { reference: 'TOP2', value: 4500 }
    ]
  })
  topStockValueArticles: Array<{ reference: string; value: number }>;

  @ApiProperty({
    example: [
      { reference: 'RISK1', daysToOutOfStock: 10 },
      { reference: 'RISK2', daysToOutOfStock: 20 }
    ]
  })
  stockRiskPredictions: Array<{ reference: string; daysToOutOfStock: number }>;

  @ApiProperty({ example: ['OLD1', 'OLD2'] })
  toArchiveSuggestions: string[];
}