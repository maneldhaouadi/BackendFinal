import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { ArticleService } from 'src/modules/article/services/article.service';
import { ResponseArticleDto } from 'src/modules/article/dtos/article.response.dto';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { LineItem } from 'src/common/calculations/interfaces/line-item.interface';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindOneOptions } from 'typeorm';
import { ExpenseArticleInvoiceEntryRepository } from '../repositories/repository/expense-invoice-article-entry.repository';
import { ExpenseArticleInvoiceEntryTaxService } from './expense-article-invoice-entry-tax.service';
import { ExpenseResponseArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.response.dto';
import { ExpenseArticleInvoiceEntryEntity } from '../repositories/entities/expense-article-invoice-entry.entity';
import { ExpenseCreateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.create.dto';
import { ExpenseUpdateArticleInvoiceEntryDto } from '../dtos/expense-article-invoice-entry.update.dto';
import { ExpenseArticleInvoiceEntryNotFoundException } from '../errors/expense-article-invoice-entry.notfound.error';
import { ArticleEntity } from 'src/modules/article/repositories/entities/article.entity';
import { UpdateArticleDto } from 'src/modules/article/dtos/article.update.dto';
import { ArticleStatus } from 'src/modules/article/interfaces/article-data.interface';

@Injectable()
export class ExpenseArticleInvoiceEntryService {
  constructor(
    private readonly articleInvoiceEntryRepository: ExpenseArticleInvoiceEntryRepository,
    private readonly articleInvoiceEntryTaxService: ExpenseArticleInvoiceEntryTaxService,
    private readonly articleService: ArticleService,
    private readonly taxService: TaxService,
    private readonly calculationsService: InvoicingCalculationsService,
  ) {}

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpenseResponseArticleInvoiceEntryDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const entry = await this.articleInvoiceEntryRepository.findOne(
      queryOptions as FindOneOptions<ExpenseArticleInvoiceEntryEntity>,
    );
    if (!entry) return null;
    return entry;
  }

  async findOneById(id: number): Promise<ExpenseResponseArticleInvoiceEntryDto> {
    const entry = await this.articleInvoiceEntryRepository.findOneById(id);
    if (!entry) {
      throw new ExpenseArticleInvoiceEntryNotFoundException();
    }
    return entry;
  }

  async findOneAsLineItem(id: number): Promise<LineItem> {
    const entry = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'expenseArticleInvoiceEntryTaxes',
    });
    const taxes = entry.articleInvoiceEntryTaxes
      ? await Promise.all(
          entry.articleInvoiceEntryTaxes.map((taxEntry) =>
            this.taxService.findOneById(taxEntry.taxId),
          ),
        )
      : [];
    return {
      quantity: entry.quantity,
      unit_price: entry.unit_price,
      discount: entry.discount,
      discount_type: entry.discount_type,
      taxes: taxes,
    };
  }

  async findManyAsLineItem(ids: number[]): Promise<LineItem[]> {
    const lineItems = await Promise.all(
      ids.map((id) => this.findOneAsLineItem(id)),
    );
    return lineItems;
  }

  async save(
    createArticleInvoiceEntryDto: ExpenseCreateArticleInvoiceEntryDto,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // Récupérer les taxes
    const taxes = createArticleInvoiceEntryDto.taxes
      ? await Promise.all(
          createArticleInvoiceEntryDto.taxes.map(id => this.taxService.findOneById(id))
        )
      : [];
  
    // Trouver l'article par référence ou titre
    let article = createArticleInvoiceEntryDto.article.reference
      ? await this.articleService.findOneByCondition({
          filter: `reference||$eq||${createArticleInvoiceEntryDto.article.reference}`
        })
      : null;
  
    if (!article && createArticleInvoiceEntryDto.article.title) {
      article = await this.articleService.findOneByCondition({
        filter: `title||$eq||${createArticleInvoiceEntryDto.article.title}`
      });
    }
  
    if (!article) {
      // Créer un nouvel article sans historique
      article = await this.articleService.save({
        ...createArticleInvoiceEntryDto.article,
        reference: createArticleInvoiceEntryDto.article.reference || 
                  `REF-${Math.floor(100000000 + Math.random() * 900000000)}`,
        quantityInStock: createArticleInvoiceEntryDto.quantity || 0,
        unitPrice: createArticleInvoiceEntryDto.unit_price || 0
      });
    } else {
      // Mettre à jour l'article existant sans historique
      await this.articleService.update(article.id, {
        quantityInStock: (article.quantityInStock || 0) - (createArticleInvoiceEntryDto.quantity || 0),
        unitPrice: createArticleInvoiceEntryDto.unit_price || article.unitPrice || 0
      });
    }
  
    // Créer l'entrée de facture
    const entry = await this.articleInvoiceEntryRepository.save({
      ...createArticleInvoiceEntryDto,
      reference: article.reference,
      articleId: article.id,
      article: article,
      subTotal: this.calculationsService.calculateSubTotalForLineItem({
        quantity: createArticleInvoiceEntryDto.quantity,
        unit_price: createArticleInvoiceEntryDto.unit_price,
        discount: createArticleInvoiceEntryDto.discount,
        discount_type: createArticleInvoiceEntryDto.discount_type,
        taxes: taxes
      }),
      total: this.calculationsService.calculateTotalForLineItem({
        quantity: createArticleInvoiceEntryDto.quantity,
        unit_price: createArticleInvoiceEntryDto.unit_price,
        discount: createArticleInvoiceEntryDto.discount,
        discount_type: createArticleInvoiceEntryDto.discount_type,
        taxes: taxes
      })
    });
  
    // Sauvegarder les taxes associées
    if (taxes.length > 0) {
      await this.articleInvoiceEntryTaxService.saveMany(
        taxes.map(tax => ({
          taxId: tax.id,
          articleInvoiceEntryId: entry.id
        }))
      );
    }
  
    return entry;
  }

  async saveMany(
    createArticleInvoiceEntryDtos: ExpenseCreateArticleInvoiceEntryDto[],
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const savedEntries = [];
    for (const dto of createArticleInvoiceEntryDtos) {
      const savedEntry = await this.save(dto);
      savedEntries.push(savedEntry);
    }
    return savedEntries;
  }

  async update(
    id: number,
    updateDto: ExpenseUpdateArticleInvoiceEntryDto,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // 1. Récupérer l'entrée existante avec verrouillage
    const existingEntry = await this.articleInvoiceEntryRepository.findOne({
      where: { id },
      relations: ['article', 'expenseArticleInvoiceEntryTaxes'],
      lock: { mode: "pessimistic_write" }
    });
  
    if (!existingEntry) {
      throw new NotFoundException('Article entry not found');
    }
  
    if (!existingEntry.article) {
      throw new NotFoundException('Associated article not found');
    }
  
    // 2. Calculer la différence de quantité CORRECTEMENT
    const oldQuantity = existingEntry.quantity;
    const newQuantity = updateDto.quantity;
    const quantityDifference = newQuantity - oldQuantity;
  
    // 3. Vérifier le stock avant mise à jour
    const currentStock = existingEntry.article.quantityInStock;
    const newStock = currentStock - quantityDifference;
  
    if (newStock < 0) {
      throw new BadRequestException(
        `Stock insuffisant. Stock actuel: ${currentStock}, ` +
        `Quantité demandée: ${quantityDifference}`
      );
    }
  
    // 4. Mettre à jour les taxes
    await this.handleTaxesUpdate(existingEntry, updateDto.taxes || []);
  
    // 5. Préparer les données de l'article
    const articleUpdateData = {
      title: updateDto.article?.title ?? existingEntry.article.title,
      description: updateDto.article?.description ?? existingEntry.article.description,
      reference: updateDto.article?.reference ?? existingEntry.article.reference,
      status: updateDto.article?.status ?? existingEntry.article.status,
      notes: updateDto.article?.notes ?? existingEntry.article.notes,
      unitPrice: updateDto.unit_price ?? existingEntry.article.unitPrice,
      quantityInStock: newStock // Utiliser le nouveau stock calculé
    };
  
    // 6. Mettre à jour l'article
    const article = await this.articleService.update(
      existingEntry.article.id,
      articleUpdateData
    );
  
    // 7. Calculer les nouveaux montants
    const lineItem = await this.calculateLineItem({
      ...updateDto,
      quantity: newQuantity
    }, article);
  
    // 8. Mettre à jour l'entrée de facture
    const updatedEntry = await this.articleInvoiceEntryRepository.save({
      ...existingEntry,
      ...updateDto,
      quantity: newQuantity,
      articleId: article.id,
      article: article,
      subTotal: lineItem.subTotal,
      total: lineItem.total
    });
  
    return updatedEntry;
  }
  // Méthodes helpers:
  
  private async handleTaxesUpdate(
    existingEntry: ExpenseArticleInvoiceEntryEntity, 
    newTaxIds: number[]
  ) {
    // Supprimer les anciennes taxes
    await this.articleInvoiceEntryTaxService.softDeleteMany(
      existingEntry.expenseArticleInvoiceEntryTaxes.map(t => t.id)
    );
  
    // Ajouter les nouvelles taxes
    if (newTaxIds.length > 0) {
      const taxes = await Promise.all(
        newTaxIds.map(id => this.taxService.findOneById(id))
      );
      
      await this.articleInvoiceEntryTaxService.saveMany(
        taxes.map(tax => ({
          taxId: tax.id,
          articleInvoiceEntryId: existingEntry.id
        }))
      );
    }
  }
  
  
  private generateRandomReference(): string {
    return `REF-${Math.floor(100000000 + Math.random() * 900000000)}`;
  }
  
  private async calculateLineItem(
    dto: ExpenseUpdateArticleInvoiceEntryDto,
    article: ArticleEntity
  ) {
    // Fetch full tax objects if taxes are provided
    const taxes = dto.taxes && dto.taxes.length > 0 
      ? await Promise.all(dto.taxes.map(id => this.taxService.findOneById(id)))
      : [];
  
    return {
      subTotal: this.calculationsService.calculateSubTotalForLineItem({
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        discount: dto.discount,
        discount_type: dto.discount_type,
        taxes
      }),
      total: this.calculationsService.calculateTotalForLineItem({
        quantity: dto.quantity,
        unit_price: dto.unit_price,
        discount: dto.discount,
        discount_type: dto.discount_type,
        taxes
      })
    };
  }

  async duplicate(
    id: number,
    invoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity> {
    // Fetch the existing entry with its taxes
    const existingEntry = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'expenseArticleInvoiceEntryTaxes',
    });
  
    if (!existingEntry) {
      throw new Error(`Entry with id ${id} not found`);
    }
  
    // Duplicate the taxes associated with this entry
    const duplicatedTaxes = existingEntry.articleInvoiceEntryTaxes?.map((taxEntry) => ({
      taxId: taxEntry.taxId,
    })) || [];
  
    // Create the duplicated entry
    const duplicatedEntry = this.articleInvoiceEntryRepository.create({
      ...existingEntry,
      id: undefined, // Remove the existing ID
      expenseInvoiceId: invoiceId, // Assign the new invoice ID
      expenseArticleInvoiceEntryTaxes: undefined, // Remove reference to existing taxes
      createdAt: undefined,
      updatedAt: undefined,
    });
  
    // Save the duplicated entry
    const newEntry = await this.articleInvoiceEntryRepository.save(duplicatedEntry);
  
    // Save the new tax entries for the duplicated entry
    await this.articleInvoiceEntryTaxService.saveMany(
      duplicatedTaxes.map((tax) => ({
        taxId: tax.taxId,
        articleInvoiceEntryId: newEntry.id, // Use the new entry's ID
      })),
    );
  
    return newEntry;
  }
  
  async duplicateMany(
    ids: number[],
    invoiceId: number,
  ): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const duplicatedEntries = [];
    for (const id of ids) {
      const duplicatedEntry = await this.duplicate(id, invoiceId);
      duplicatedEntries.push(duplicatedEntry);
    }
    return duplicatedEntries;
  }

  async softDelete(id: number): Promise<ExpenseArticleInvoiceEntryEntity> {
    const entry = await this.articleInvoiceEntryRepository.findByCondition({
      where: { id, deletedAt: null },
      relations: { expenseArticleInvoiceEntryTaxes: true },
    });
    await this.articleInvoiceEntryTaxService.softDeleteMany(
      entry.expenseArticleInvoiceEntryTaxes.map((taxEntry) => taxEntry.id),
    );
    return this.articleInvoiceEntryRepository.softDelete(id);
  }

  async softDeleteMany(ids: number[]): Promise<ExpenseArticleInvoiceEntryEntity[]> {
    const entries = await Promise.all(
      ids.map(async (id) => this.softDelete(id)),
    );
    return entries;
  }
}
