import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class UpdateSubCategoryDto {
  @ApiProperty({
    example: 'Premium Smartphones',
    description: 'Updated name of the sub-category',
    required: false
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 2,
    description: 'New parent category ID',
    required: false
  })
  @IsNumber()
  @IsOptional()
  categoryId?: number;

  @ApiProperty({
    example: false,
    description: 'Set sub-category active status',
    required: false
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}