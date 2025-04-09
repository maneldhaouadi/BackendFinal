import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from 'src/modules/category/dtos/category.create.dto';

export class SubCategoryResponseDto {
  @ApiProperty({ example: 1, description: 'Unique identifier' })
  id: number;

  @ApiProperty({ example: 'Smartphones', description: 'Sub-category name' })
  name: string;

  @ApiProperty({ type: CategoryResponseDto, description: 'Parent category' })
  category: CategoryResponseDto;

  @ApiProperty({ example: true, description: 'Active status' })
  isActive: boolean;

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