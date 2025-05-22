import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from 'typeorm';
import { TemplateType } from '../../enums/TemplateType';
import { ExpensQuotationEntity } from 'src/modules/expense_quotation/repositories/entities/expensquotation.entity';

@Entity()
export class Template {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({unique: true})
  name: string;

  @Column('text')
  content: string;

  @Column({ type: 'enum', enum: TemplateType })
  type: TemplateType; // 'invoice' | 'quotation' | 'payment'

  @Column({ default: false })
  isDefault: boolean;


@OneToMany(() => ExpensQuotationEntity, (devis) => devis.template)
expenseQuotations: ExpensQuotationEntity[];


  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date;

  @Column({ default: false })
  isDeletionRestricted: boolean;
}