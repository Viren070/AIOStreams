export class DSU<IDType extends string | number> {
  private parent: Map<IDType, IDType>;
  private rank: Map<IDType, number>;

  constructor() {
    this.parent = new Map<IDType, IDType>();
    this.rank = new Map<IDType, number>();
  }

  makeSet(id: IDType): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: IDType): IDType {
    if (!this.parent.has(id)) {
      this.makeSet(id); // Ensure set exists if find is called before makeSet
      return id;
    }
    if (this.parent.get(id) === id) {
      return id;
    }
    const root = this.find(this.parent.get(id)!);
    this.parent.set(id, root);
    return root;
  }

  union(id1: IDType, id2: IDType): void {
    const root1 = this.find(id1);
    const root2 = this.find(id2);
    if (root1 !== root2) {
      const rank1 = this.rank.get(root1)!;
      const rank2 = this.rank.get(root2)!;
      if (rank1 < rank2) {
        this.parent.set(root1, root2);
      } else if (rank1 > rank2) {
        this.parent.set(root2, root1);
      } else {
        this.parent.set(root2, root1);
        this.rank.set(root1, rank1 + 1);
      }
    }
  }
}
