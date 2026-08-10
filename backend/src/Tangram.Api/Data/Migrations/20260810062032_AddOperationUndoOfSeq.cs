using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationUndoOfSeq : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "undo_of_seq",
                table: "operations",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "undo_of_seq",
                table: "operations");
        }
    }
}
