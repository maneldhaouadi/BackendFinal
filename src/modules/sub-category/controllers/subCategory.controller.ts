import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SubCategoryService } from '../services/subCategory.service';
import { CreateSubCategoryDto } from '../dtos/subCategory.create.dto';
import { SubCategoryResponseDto } from '../dtos/subCategory.response.dto';
import { UpdateSubCategoryDto } from '../dtos/subCategory.update.dto';


@ApiTags('SubCategories')
@Controller('sub-categories')
export class SubCategoryController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sub-categories' })
  @ApiResponse({ status: 200, type: [SubCategoryResponseDto] })
  async findAll() {
    return this.subCategoryService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sub-category by ID' })
  @ApiResponse({ status: 200, type: SubCategoryResponseDto })
  async findOne(@Param('id') id: number) {
    return this.subCategoryService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new sub-category' })
  @ApiResponse({ status: 201, type: SubCategoryResponseDto })
  async create(@Body() createSubCategoryDto: CreateSubCategoryDto) {
    return this.subCategoryService.create(createSubCategoryDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a sub-category' })
  @ApiResponse({ status: 200, type: SubCategoryResponseDto })
  async update(@Param('id') id: number, @Body() updateSubCategoryDto: UpdateSubCategoryDto) {
    return this.subCategoryService.update(id, updateSubCategoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a sub-category' })
  @ApiResponse({ status: 204 })
  async delete(@Param('id') id: number) {
    return this.subCategoryService.delete(id);
  }
}