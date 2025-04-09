import { ApiProperty } from '@nestjs/swagger';
import { SubCategoryResponseDto } from 'src/modules/sub-category/dtos/subCategory.response.dto';

export class CategoryResponseDto {
  @ApiProperty({ example: 1, description: 'Unique identifier' })
  id: number;

  @ApiProperty({ example: 'Electronics', description: 'Category name' })
  name: string;

  @ApiProperty({
    example: 'All electronic devices',
    description: 'Category description',
    required: false
  })
  description?: string;

  @ApiProperty({ example: true, description: 'Active status' })
  isActive: boolean;

  @ApiProperty({
    type: [SubCategoryResponseDto],
    description: 'List of sub-categories',
    required: false
  })
  subCategories?: SubCategoryResponseDto[];

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Creation date'
  })
  createdAt: Date;

  @ApiProperty({
    example: '2023-01-01T00:00:00.000Z',
    description: 'Last update date'
  })
  updatedAt: Date;
}